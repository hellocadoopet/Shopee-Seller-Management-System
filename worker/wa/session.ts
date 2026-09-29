/**
 * What the manager needs from one WhatsApp connection. BaileysSession is the real one; the
 * check script drives the manager with a fake, so nothing above this line knows about Baileys.
 */
import type { EventEmitter } from "node:events";
import type { WaMessageType } from "../../adapters/whatsapp/contract.js";

export type SessionStatus = "connecting" | "qr" | "connected" | "disconnected" | "logged_out";

export type ReceiptStatus = "sent" | "delivered" | "read" | "failed";

/** One 1:1 chat message, already parsed out of Baileys' shapes. */
export interface Envelope {
  waMessageId: string;
  /** The exact jid it arrived on — where replies must go (may be "@lid"). */
  routingJid: string;
  /** Contact merge key: the phone jid when WhatsApp tells us, else = routingJid. */
  canonicalJid: string;
  /** Their WhatsApp push name; null on our own (fromMe) messages. */
  pushName: string | null;
  /** Text, or a media caption; null for media without one. */
  body: string | null;
  type: WaMessageType;
  /** Set for image/video/audio/document/sticker. `size` is the sender's declared byte count. */
  media: { mime: string | null; filename: string | null; size: number | null } | null;
  /** Live media only (never history): fetches the file's bytes from WhatsApp. */
  download?: () => Promise<Buffer>;
  direction: "in" | "out";
  timestamp: Date;
  /** Backfilled on connect: never bumps unread or moves last_message back. */
  isHistory: boolean;
}

/**
 * Who someone is, as WhatsApp tells us outside of messages: the phone behind a hidden "@lid" id,
 * and their names. Any field may be missing.
 */
export interface Identity {
  lid: string | null;
  pn: string | null;
  /** The linked phone's address-book name for them. */
  savedName: string | null;
  /** The name they set on WhatsApp themselves. */
  pushName: string | null;
}

export interface SessionEvents {
  /** A new pairing QR (raw string; the manager renders it). */
  qr: [qr: string];
  connected: [info: { phoneNumber: string | null }];
  status: [status: SessionStatus];
  /** The device was removed / logged out on the phone. The session has stopped itself. */
  loggedOut: [];
  /** A live message (incoming, or sent from the phone / this socket). */
  message: [envelope: Envelope];
  /** One messaging-history.set batch (can be thousands of messages); persisted in bulk. */
  history: [envelopes: Envelope[]];
  receipt: [info: { waMessageId: string; status: ReceiptStatus }];
  /** Identities from history sync, contact sync or a phone-number share. Emitted before the matching history batch. */
  directory: [identities: Identity[]];
}

export interface WaSession extends Pick<EventEmitter<SessionEvents>, "on" | "removeAllListeners"> {
  readonly accountId: string;
  readonly status: SessionStatus;
  /** True once this session has reached "connected" at least once. */
  readonly everConnected: boolean;
  /** Connected AND the socket is really open (catches sockets that died without a close event). */
  isAlive(): boolean;
  /** A backoff reconnect is already scheduled — the watchdog must not start another. */
  reconnectPending(): boolean;
  start(): Promise<void>;
  /** Close for good (no reconnect). Keeps the auth folder. */
  stop(): Promise<void>;
  /** Send a text; resolves with WhatsApp's message id. */
  sendText(jid: string, text: string): Promise<string>;
  /** Ask WhatsApp to re-send the whole contact list (names + "@lid" ids) — emits `directory`. */
  resyncContacts(): Promise<void>;
}

export type SessionFactory = (accountId: string, sessionDir: string) => WaSession;
