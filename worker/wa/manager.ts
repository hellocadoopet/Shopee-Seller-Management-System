/**
 * Registry of live sessions: pairing new numbers, resuming paired ones on boot, the reconnect
 * watchdog, and sending. Depends only on the WaSession interface, so it can run on fakes.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import QRCode from "qrcode";
import type { PairingStatusResponse, WaAccountStatus } from "../../adapters/whatsapp/contract.js";
import { logger } from "../logger.js";
import { accountExists, createPairedAccount, getAccount, listResumableAccounts, setAccountStatus } from "./accounts.js";
import { persistHistory } from "./history.js";
import { backfillFromContacts, hasAddressBook, learn } from "./directory.js";
import { attachMedia } from "./media.js";
import { applyReceipt, persistMessage, persistOutbound } from "./persistence.js";
import { drain } from "./queue.js";
import type { SessionFactory, SessionStatus, WaSession } from "./session.js";

interface Pairing {
  id: string;
  label: string | null;
  state: PairingStatusResponse["state"];
  qrDataUrl?: string;
  shopId?: string;
  reason?: string;
  /** Account rows are being written; the pairing can no longer be cancelled or expire. */
  completing: boolean;
  timer: ReturnType<typeof setTimeout>;
  /** Re-linking a logged-out number: only this phone may complete it (null = any, a fresh link). */
  relinkPhone: string | null;
}

/** startPairing refused: maps to an HTTP status. */
export class PairingError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export type SendResult = { ok: true; messageId: string } | { ok: false; error: "not_found" | "not_connected" };

export interface ManagerOptions {
  sessionsDir: string;
  createSession: SessionFactory;
  /** A pairing that hasn't connected by then is cancelled and its folder removed. */
  pairingTtlMs?: number;
  /** How long a finished (connected/failed) pairing stays pollable. */
  pairingKeepMs?: number;
}

export class SessionManager {
  /** Paired accounts' sessions (not pairings in progress). */
  private sessions = new Map<string, WaSession>();
  /** Last known status of every account this process knows about — backs GET /health. */
  private statuses = new Map<string, WaAccountStatus>();
  private pairings = new Map<string, Pairing>();
  /** Sessions of pairings that haven't become accounts yet. */
  private pairingSessions = new Map<string, WaSession>();
  /** Accounts mid-reconnect, so the watchdog never runs two at once. */
  private reconnecting = new Set<string>();
  /** Accounts whose directory was checked this process (backfill + one contact resync if needed). */
  private directoryChecked = new Set<string>();
  /** False until the boot resume could read wa_accounts (Supabase may be down at boot). */
  private resumedAll = false;
  private readonly pairingTtlMs: number;
  private readonly pairingKeepMs: number;

  constructor(private readonly opts: ManagerOptions) {
    this.pairingTtlMs = opts.pairingTtlMs ?? 3 * 60_000;
    this.pairingKeepMs = opts.pairingKeepMs ?? 10 * 60_000;
  }

  private dirFor(accountId: string) {
    return join(this.opts.sessionsDir, accountId);
  }

  // ─── Pairing ───

  /**
   * Start pairing. The pairing id becomes the account id (and its session folder): a new uuid for a
   * new number, or — to re-link a logged-out number — that number's existing account id, so its
   * chats are kept and the new sync de-duplicates against them.
   */
  async startPairing(label?: string, relinkAccountId?: string): Promise<string> {
    let relinkPhone: string | null = null;
    if (relinkAccountId) {
      const acc = await getAccount(relinkAccountId);
      if (!acc) throw new PairingError(404, "unknown account");
      if (acc.status !== "logged_out" || this.sessions.has(relinkAccountId)) throw new PairingError(409, "this number is still linked");
      const previous = this.pairings.get(relinkAccountId);
      if (previous?.completing) throw new PairingError(409, "this number is linking right now");
      if (previous) await this.cancelPairing(relinkAccountId); // a second "re-link" click replaces the first QR
      await rm(this.dirFor(relinkAccountId), { recursive: true, force: true }); // dead login from before
      relinkPhone = acc.phoneNumber;
      label = acc.shopName ?? label; // keep its name
    }
    const id = relinkAccountId ?? randomUUID();
    const pairing: Pairing = {
      id,
      label: label?.trim() || null,
      state: "starting",
      completing: false,
      timer: setTimeout(() => void this.expirePairing(id), this.pairingTtlMs),
      relinkPhone,
    };
    pairing.timer.unref?.();
    this.pairings.set(id, pairing);

    const session = this.opts.createSession(id, this.dirFor(id));
    this.wire(session, pairing);
    logger.info({ pairingId: id, relink: !!relinkAccountId }, "pairing started");
    session.start().catch((err) => void this.failPairing(pairing, session, `start failed: ${String(err)}`));
    return id;
  }

  getPairing(id: string): PairingStatusResponse | null {
    const p = this.pairings.get(id);
    if (!p) return null;
    if (p.state === "qr") return { state: "qr", qr_data_url: p.qrDataUrl };
    if (p.state === "connected") return { state: "connected", shop_id: p.shopId };
    if (p.state === "failed") return { state: "failed", reason: p.reason };
    return { state: p.state };
  }

  /** User closed the QR screen. A pairing that already connected keeps its account. */
  async cancelPairing(id: string): Promise<boolean> {
    const p = this.pairings.get(id);
    if (!p) return false;
    this.forgetPairing(p);
    if (p.state !== "connected" && !p.completing) await this.discardPairingSession(id);
    return true;
  }

  private forgetPairing(p: Pairing) {
    clearTimeout(p.timer);
    this.pairings.delete(p.id);
  }

  /** Keep a finished pairing pollable for a while, then drop it (GET → 404). */
  private finishPairing(p: Pairing) {
    clearTimeout(p.timer);
    p.timer = setTimeout(() => this.pairings.delete(p.id), this.pairingKeepMs);
    p.timer.unref?.();
  }

  private async expirePairing(id: string) {
    const p = this.pairings.get(id);
    if (!p || p.completing || p.state === "connected") return;
    logger.info({ pairingId: id }, "pairing expired");
    this.forgetPairing(p);
    await this.discardPairingSession(id);
  }

  private async failPairing(p: Pairing, session: WaSession, reason: string) {
    if (p.state === "connected" || p.state === "failed") return;
    logger.warn({ pairingId: p.id, reason }, "pairing failed");
    p.state = "failed";
    p.reason = reason;
    this.finishPairing(p);
    this.pairingSessions.set(p.id, session);
    await this.discardPairingSession(p.id);
  }

  private async discardPairingSession(id: string) {
    const s = this.pairingSessions.get(id);
    this.pairingSessions.delete(id);
    if (s) {
      s.removeAllListeners();
      await s.stop().catch(() => {});
    }
    await rm(this.dirFor(id), { recursive: true, force: true });
  }

  /**
   * First successful connect of a pairing: shops row, then wa_accounts row, then it's a normal
   * account. One-shot — later reconnects of the same session only update status (the source app
   * re-ran the insert on every reconnect and hit a primary-key conflict).
   */
  private async completePairing(p: Pairing, session: WaSession, phoneNumber: string | null) {
    // Re-link scanned by another phone: refuse, or two numbers' chats would mix in one account.
    if (p.relinkPhone && phoneNumber !== p.relinkPhone) {
      await this.failPairing(p, session, `Scanned by +${phoneNumber ?? "an unknown number"}, not +${p.relinkPhone}. Scan with +${p.relinkPhone}'s phone, or link the other phone as a new number.`);
      return;
    }
    p.completing = true;
    try {
      const shopId = await createPairedAccount(p.id, p.label || phoneNumber || "WhatsApp", phoneNumber);
      this.pairingSessions.delete(p.id);
      this.sessions.set(p.id, session);
      this.statuses.set(p.id, toAccountStatus(session.status));
      p.state = "connected";
      p.shopId = shopId;
      this.finishPairing(p);
      logger.info({ accountId: p.id, shopId }, "pairing connected");
      // It may have dropped while the rows were being written.
      if (session.status !== "connected") void setAccountStatus(p.id, toAccountStatus(session.status)).catch(logDbError(p.id));
    } catch (err) {
      await this.failPairing(p, session, `could not save account: ${String(err)}`);
    } finally {
      p.completing = false;
    }
  }

  // ─── Resume / reconnect ───

  /** Boot: reconnect every account that isn't logged out. */
  async resumeAll(): Promise<void> {
    const accounts = await listResumableAccounts();
    this.resumedAll = true;
    logger.info({ count: accounts.length }, "resuming accounts");
    for (const a of accounts) {
      await this.resume(a.id).catch((err) => logger.error({ accountId: a.id, err: String(err) }, "resume failed"));
    }
  }

  async resume(accountId: string): Promise<void> {
    if (this.sessions.has(accountId)) return;
    this.statuses.set(accountId, "connecting");
    if (!existsSync(join(this.dirFor(accountId), "creds.json"))) {
      // No saved login (folder lost / never finished): only a fresh QR scan can bring it back.
      logger.warn({ accountId }, "no saved login on disk — marking logged out");
      await this.markLoggedOut(accountId);
      return;
    }
    const session = this.opts.createSession(accountId, this.dirFor(accountId));
    this.sessions.set(accountId, session);
    this.wire(session, null);
    try {
      await session.start();
    } catch (err) {
      // Don't leave a half-started session behind: the watchdog retries accounts with no session.
      session.removeAllListeners();
      this.sessions.delete(accountId);
      this.statuses.set(accountId, "disconnected");
      throw err;
    }
  }

  /** Replace an account's session with a fresh one (the source did nothing if a stale one existed). */
  async reconnect(accountId: string): Promise<void> {
    if (this.reconnecting.has(accountId)) return;
    this.reconnecting.add(accountId);
    try {
      const old = this.sessions.get(accountId);
      this.sessions.delete(accountId);
      if (old) {
        old.removeAllListeners(); // its close must not write status or schedule anything
        await old.stop().catch(() => {});
      }
      await this.resume(accountId);
    } finally {
      this.reconnecting.delete(accountId);
    }
  }

  /**
   * Catches sockets that died without a close event (so Baileys' own backoff never ran). Only
   * touches sessions that have connected before and are now dead with no reconnect scheduled —
   * never one that's still connecting, and never on top of a pending backoff.
   */
  async watchdog(): Promise<void> {
    if (!this.resumedAll) await this.resumeAll();
    for (const [id, s] of [...this.sessions]) {
      if (!s.everConnected || s.reconnectPending() || this.reconnecting.has(id)) continue;
      const silentlyDead = s.status === "connected" && !s.isAlive();
      const stuck = s.status === "disconnected";
      if (!silentlyDead && !stuck) continue;
      logger.warn({ accountId: id, status: s.status }, "watchdog: replacing dead session");
      await this.reconnect(id).catch((err) => logger.error({ accountId: id, err: String(err) }, "watchdog reconnect failed"));
    }
    // Accounts whose resume threw (e.g. transient error at boot).
    for (const [id, status] of this.statuses) {
      if (status !== "logged_out" && !this.sessions.has(id) && !this.reconnecting.has(id)) {
        await this.reconnect(id).catch((err) => logger.error({ accountId: id, err: String(err) }, "watchdog resume failed"));
      }
    }
  }

  /** Logged out on the phone (or creds gone): keep the rows, stop for good, delete the auth folder. */
  private async markLoggedOut(accountId: string) {
    const s = this.sessions.get(accountId);
    this.sessions.delete(accountId);
    if (s) {
      s.removeAllListeners();
      await s.stop().catch(() => {});
    }
    this.statuses.set(accountId, "logged_out");
    logger.warn({ accountId }, "account logged out");
    await setAccountStatus(accountId, "logged_out").catch(logDbError(accountId));
    await rm(this.dirFor(accountId), { recursive: true, force: true });
  }

  // ─── Wiring ───

  /** `pairing` is set for a number being paired; null for an already-paired (resumed) account. */
  private wire(session: WaSession, pairing: Pairing | null) {
    const id = session.accountId;
    if (pairing) this.pairingSessions.set(id, session);
    // Account rows exist (resumed) or are being created (pairing). Messages that arrive while
    // pairing completes — history sync starts right away — wait for it instead of hitting the FK.
    let ready: Promise<boolean> | null = pairing ? null : Promise.resolve(true);
    const isAccount = () => !pairing || pairing.state === "connected" || pairing.completing;

    session.on("qr", (qr) => {
      if (!pairing || isAccount()) {
        // A paired session asking for a QR means its creds are dead, and nobody is there to scan.
        void this.markLoggedOut(id);
        return;
      }
      pairing.state = "qr";
      QRCode.toDataURL(qr)
        .then((url) => {
          if (pairing.state === "qr") pairing.qrDataUrl = url;
        })
        .catch((err) => logger.error({ pairingId: id, err: String(err) }, "QR render failed"));
    });

    session.on("connected", ({ phoneNumber }) => {
      if (pairing && !ready) {
        const done = this.completePairing(pairing, session, phoneNumber);
        ready = done.then(() => pairing.state === "connected");
      }
      // A fresh link gets the contact list from Baileys' own initial sync; a resumed one may predate the directory.
      if (!pairing) void this.checkDirectory(id, session);
    });

    session.on("directory", (identities) => {
      void (ready ?? Promise.resolve(false))
        .then((ok) => (ok ? learn(id, identities) : undefined))
        .catch((err) => logger.error({ accountId: id, count: identities.length, err: String(err) }, "directory update failed"));
    });

    session.on("status", (status) => {
      if (status === "qr" || status === "logged_out") return; // handled by their own events
      if (pairing && !isAccount()) return; // no wa_accounts row yet
      void (ready ?? Promise.resolve(false)).then((ok) => {
        if (!ok) return;
        const next = toAccountStatus(status);
        if (this.statuses.get(id) === "logged_out") return;
        this.statuses.set(id, next);
        return setAccountStatus(id, next);
      }).catch(logDbError(id));
    });

    session.on("loggedOut", () => {
      if (pairing && !isAccount()) void this.failPairing(pairing, session, "logged out");
      else void this.markLoggedOut(id);
    });

    session.on("message", (env) => {
      void (ready ?? Promise.resolve(false))
        .then(async (ok) => {
          const saved = ok ? await persistMessage(id, env) : null;
          // Row first, file after: the download runs outside the queue and can't lose the message.
          if (saved?.inserted && env.download) await attachMedia(id, saved.conversationId, env);
        })
        .catch((err) => logger.error({ accountId: id, waMessageId: env.waMessageId, err: String(err) }, "persist failed"));
    });

    session.on("history", (envs) => {
      void (ready ?? Promise.resolve(false))
        .then(async (ok) => {
          if (!ok) return;
          const r = await persistHistory(id, envs);
          logger.info({ accountId: id, ...r }, "history batch persisted");
        })
        .catch((err) => logger.error({ accountId: id, count: envs.length, err: String(err) }, "history persist failed"));
    });

    session.on("receipt", ({ waMessageId, status }) => {
      void (ready ?? Promise.resolve(false))
        .then((ok) => (ok ? applyReceipt(id, waMessageId, status) : false))
        .catch((err) => logger.error({ accountId: id, waMessageId, err: String(err) }, "receipt failed"));
    });
  }

  /**
   * Once per account per process: learn the "@lid" ↔ phone pairings already stored in contacts
   * (merging duplicates made before the directory existed), and if no address-book names were ever
   * received, ask WhatsApp to re-send the contact list.
   */
  private async checkDirectory(accountId: string, session: WaSession) {
    if (this.directoryChecked.has(accountId)) return;
    this.directoryChecked.add(accountId);
    try {
      await backfillFromContacts(accountId);
      if (await hasAddressBook(accountId)) return;
      logger.info({ accountId }, "no address book yet — requesting contact resync");
      await session.resyncContacts();
    } catch (err) {
      this.directoryChecked.delete(accountId); // retry on the next connect
      logger.error({ accountId, err: String(err) }, "directory check failed");
    }
  }

  // ─── Send / health / shutdown ───

  async sendText(accountId: string, jid: string, text: string): Promise<SendResult> {
    const s = this.sessions.get(accountId);
    if (!s) {
      const known = this.statuses.has(accountId) || (await accountExists(accountId));
      return { ok: false, error: known ? "not_connected" : "not_found" };
    }
    if (s.status !== "connected") return { ok: false, error: "not_connected" };
    const waMessageId = await s.sendText(jid, text);
    const messageId = await persistOutbound(accountId, waMessageId, jid, text);
    logger.info({ accountId, messageId }, "message sent");
    return { ok: true, messageId };
  }

  health(): Array<{ id: string; status: WaAccountStatus }> {
    return [...this.statuses].map(([id, status]) => ({ id, status }));
  }

  /** Graceful stop: close every socket (auth folders stay) and record them as disconnected. */
  async shutdown(): Promise<void> {
    // Unfinished pairings can't be resumed without an account row — drop them and their folders.
    for (const id of [...this.pairingSessions.keys()]) await this.discardPairingSession(id);
    for (const [id, s] of this.sessions) {
      s.removeAllListeners();
      await s.stop().catch(() => {});
      await setAccountStatus(id, "disconnected").catch(logDbError(id));
      await drain(id);
    }
    this.sessions.clear();
  }
}

function toAccountStatus(s: SessionStatus): WaAccountStatus {
  return s === "qr" ? "logged_out" : s;
}

const logDbError = (accountId: string) => (err: unknown) =>
  logger.error({ accountId, err: String(err) }, "account status write failed");
