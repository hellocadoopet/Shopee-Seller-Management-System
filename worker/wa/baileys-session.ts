/** One Baileys socket = one WhatsApp number. Reconnects itself with backoff until stopped or logged out. */
import { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import {
  ALL_WA_PATCH_NAMES,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type AuthenticationState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { baileysLogLevel, logger } from "../logger.js";
import { historyEnvelopes, identityOfChat, identityOfContact, jidToPhone, receiptStatus, toEnvelope } from "./parse.js";
import type { Identity, SessionEvents, SessionStatus, WaSession } from "./session.js";

const MAX_BACKOFF_MS = 60_000;

export class BaileysSession extends EventEmitter<SessionEvents> implements WaSession {
  status: SessionStatus = "connecting";
  everConnected = false;
  private sock: WASocket | null = null;
  private auth: AuthenticationState | null = null;
  private stopped = false;
  /** Consecutive failed reconnects — drives the backoff. Reset on open. */
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly accountId: string,
    private readonly dir: string,
  ) {
    super();
  }

  isAlive() {
    return this.status === "connected" && !!this.sock?.ws.isOpen;
  }

  reconnectPending() {
    return this.timer !== null;
  }

  private setStatus(s: SessionStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emit("status", s);
  }

  async start(): Promise<void> {
    if (this.stopped) return;
    this.setStatus("connecting");
    await mkdir(this.dir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.dir);
    this.auth = state;
    const { version } = await fetchLatestBaileysVersion(); // falls back to the bundled version offline
    if (this.stopped) return;

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ["Shopee Solo", "Chrome", "1.0.0"],
      logger: logger.child({ component: "baileys", accountId: this.accountId }, { level: baileysLogLevel }) as never,
      // Ping every 30s so an idle socket isn't dropped; Baileys closes it (connectionLost) if pings stop answering.
      keepAliveIntervalMs: 30_000,
      // Not "online" on connect: keeps push notifications flowing to the phone and avoids presence churn.
      markOnlineOnConnect: false,
      connectTimeoutMs: 60_000,
      retryRequestDelayMs: 1_000,
      // The phone streams its whole history in several messaging-history.set batches; each one
      // is persisted in bulk (persistHistory), so this is safe on a normal Postgres.
      syncFullHistory: true,
    });
    this.sock = sock;
    // Every handler ignores events from a socket we've already replaced.
    const current = () => this.sock === sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (!current()) return;
      if (qr) {
        this.setStatus("qr");
        this.emit("qr", qr);
      }
      if (connection === "open") {
        this.attempts = 0;
        this.everConnected = true;
        this.setStatus("connected");
        this.emit("connected", { phoneNumber: sock.user?.id ? jidToPhone(sock.user.id) : null });
      }
      if (connection === "close") {
        const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        this.sock = null;
        if (code === DisconnectReason.loggedOut) {
          // Device removed on the phone: the saved creds are dead, retrying is pointless.
          this.stopped = true;
          this.setStatus("logged_out");
          this.emit("loggedOut");
          return;
        }
        this.setStatus("disconnected");
        // restartRequired is Baileys' normal step right after a QR scan — reconnect at once.
        this.scheduleReconnect(code === DisconnectReason.restartRequired, code);
      }
    });

    // Live messages. "append" also carries messages delivered while we were offline and our own
    // sends echoed back — both are real chat messages, so both are kept.
    sock.ev.on("messages.upsert", ({ messages }) => {
      if (!current()) return;
      for (const m of messages) {
        const env = toEnvelope(m, false);
        if (!env) continue;
        if (env.media) {
          const log = logger.child({ component: "media-dl", accountId: this.accountId }, { level: baileysLogLevel });
          // Expired media URLs are re-requested from the phone via updateMediaMessage.
          env.download = async () =>
            (await downloadMediaMessage(m, "buffer", {}, { logger: log as never, reuploadRequest: sock.updateMediaMessage })) as Buffer;
        }
        this.emit("message", env);
      }
    });

    // Who is who (phone behind each "@lid", address-book names) — emitted before the batch's
    // messages so they're keyed by phone, not "@lid". History media is never downloaded.
    sock.ev.on("messaging-history.set", ({ messages, chats, contacts }) => {
      if (!current()) return;
      this.emitDirectory([...(chats ?? []).map(identityOfChat), ...(contacts ?? []).map(identityOfContact)]);
      if (!Array.isArray(messages)) return;
      const envs = historyEnvelopes(messages);
      if (envs.length) this.emit("history", envs);
    });

    // Contact sync (the phone's address book: saved names + "@lid" ids) and later edits to it.
    sock.ev.on("contacts.upsert", (cs) => current() && this.emitDirectory(cs.map(identityOfContact)));
    sock.ev.on("contacts.update", (cs) => current() && this.emitDirectory(cs.map(identityOfContact)));
    // Someone behind an "@lid" shared their number with us.
    sock.ev.on("chats.phoneNumberShare", ({ lid, jid }) => current() && this.emitDirectory([identityOfContact({ id: lid, lid, jid })]));

    // Delivery / read receipts for messages we sent.
    sock.ev.on("messages.update", (updates) => {
      if (!current()) return;
      for (const u of updates) {
        const id = u.key.id;
        const n = u.update.status;
        if (!id || !u.key.fromMe || n == null) continue;
        const status = receiptStatus(n);
        if (status) this.emit("receipt", { waMessageId: id, status });
      }
    });
  }

  private emitDirectory(ids: Array<Identity | null>) {
    const found = ids.filter((i): i is Identity => !!i);
    if (found.length) this.emit("directory", found);
  }

  /**
   * Forget how far the app state (which holds the contact list) was synced and fetch it again from
   * a snapshot, so WhatsApp re-sends every contact. For numbers linked before the worker kept the
   * directory; Baileys does this by itself on a fresh link.
   */
  async resyncContacts(): Promise<void> {
    const sock = this.sock;
    if (!sock || !this.auth || this.status !== "connected") return;
    await this.auth.keys.set({ "app-state-sync-version": Object.fromEntries(ALL_WA_PATCH_NAMES.map((n) => [n, null])) });
    await sock.resyncAppState(ALL_WA_PATCH_NAMES, true);
  }

  private scheduleReconnect(immediate: boolean, code?: number) {
    if (this.stopped || this.timer) return;
    const delay = immediate ? 0 : Math.min(2_500 * 2 ** this.attempts, MAX_BACKOFF_MS);
    if (!immediate) this.attempts += 1;
    logger.info({ accountId: this.accountId, code, delay, attempt: this.attempts }, "scheduling reconnect");
    this.timer = setTimeout(() => {
      this.timer = null;
      // A failed start (e.g. network down) must not leave the session dead: back off and retry.
      this.start().catch((err) => {
        logger.error({ accountId: this.accountId, err: String(err) }, "reconnect failed");
        this.setStatus("disconnected");
        this.scheduleReconnect(false);
      });
    }, delay);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const sock = this.sock;
    this.sock = null;
    try {
      sock?.end(undefined);
    } catch {
      /* already closed */
    }
    if (this.status !== "logged_out") this.setStatus("disconnected");
  }

  async sendText(jid: string, text: string): Promise<string> {
    const sock = this.sock;
    if (!sock || this.status !== "connected") throw new Error(`Session ${this.accountId} not connected (${this.status})`);
    await this.simulateTyping(sock, jid, text.length);
    const sent = await sock.sendMessage(jid, { text });
    const id = sent?.key.id;
    if (!id) throw new Error("WhatsApp returned no message id");
    return id;
  }

  /**
   * Anti-ban: show "typing…" for a moment scaled a little by length before sending, like a person.
   * Best-effort — presence failures never block the send.
   */
  private async simulateTyping(sock: WASocket, jid: string, length: number) {
    try {
      await sock.sendPresenceUpdate("available");
      await sock.sendPresenceUpdate("composing", jid);
      await new Promise((r) => setTimeout(r, Math.min(3500, 600 + length * 25 + Math.random() * 800)));
      await sock.sendPresenceUpdate("paused", jid);
    } catch {
      /* presence is best-effort */
    }
  }
}
