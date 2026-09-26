/**
 * The contract between the dashboard (Vercel) and the WhatsApp worker (always-on process, worker/).
 *
 *   - The worker owns the Baileys sockets. It writes wa_accounts / wa_contacts / wa_conversations /
 *     wa_messages (db/migrations/002_whatsapp.sql) and, when a number finishes pairing, its `shops` row.
 *   - The dashboard reads those tables directly (so the inbox works even while the worker restarts)
 *     and calls the worker's HTTP API only for things that need the live socket: pairing and sending.
 *
 * Worker HTTP API — every route except GET /health requires `Authorization: Bearer <WA_WORKER_SECRET>`.
 */

/** Private bucket shared by every platform; each platform keeps its files under its own prefix. */
export const MEDIA_BUCKET = "media";
/** Larger files aren't downloaded (the worker holds each one in memory; Supabase free tier caps files at 50 MB). */
export const MEDIA_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Where a message's file is stored in MEDIA_BUCKET: whatsapp/<account>/<conversation>/<message>.<ext>
 * Grouped by conversation so one customer's files can be deleted together. No phone numbers, names
 * or original file names in the path — paths show up in dashboards and logs (the name is in media_filename).
 */
export function mediaObjectPath(p: { accountId: string; conversationId: string; waMessageId: string; ext: string }): string {
  return `whatsapp/${p.accountId}/${p.conversationId}/${p.waMessageId}.${p.ext}`;
}

// ─── Table rows (snake_case, as stored) ───

export type WaAccountStatus = "connecting" | "connected" | "disconnected" | "logged_out";

export interface WaAccountRow {
  id: string;
  shop_id: string;
  phone_number: string | null;
  status: WaAccountStatus;
  last_seen_at: string | null;
  created_at: string;
}

export interface WaContactRow {
  id: string;
  account_id: string;
  jid: string;
  routing_jid: string | null;
  name: string | null;
  phone_number: string | null;
}

export interface WaConversationRow {
  id: string;
  account_id: string;
  contact_id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
}

export type WaMessageType = "text" | "image" | "video" | "audio" | "document" | "sticker" | "other";

export interface WaMessageRow {
  id: string;
  conversation_id: string;
  account_id: string;
  wa_message_id: string;
  direction: "in" | "out";
  type: WaMessageType;
  body: string | null;
  /** Object path in MEDIA_BUCKET — see mediaObjectPath(). */
  media_path: string | null;
  media_mime: string | null;
  media_filename: string | null;
  status: "sent" | "delivered" | "read" | "failed" | null;
  created_at: string;
}

// ─── HTTP API ───

/** POST /pairings — start pairing a new number. */
export interface StartPairingRequest {
  label?: string; // becomes the shop name; defaults to the phone number once known
}
export interface StartPairingResponse {
  pairing_id: string;
}

/**
 * GET /pairings/:id — poll every ~2s while the QR is shown.
 * QR codes rotate roughly every 20s; `qr_data_url` is always the current one (a PNG data: URL).
 * On "connected" the worker has already created the shops + wa_accounts rows.
 * Unknown / expired pairing ids → 404.
 */
export interface PairingStatusResponse {
  state: "starting" | "qr" | "connected" | "failed";
  qr_data_url?: string;
  shop_id?: string; // set when connected
  reason?: string; // set when failed
}

/** DELETE /pairings/:id — user closed the QR screen. → { ok: true } */

/**
 * POST /accounts/:accountId/send — send a text reply.
 * `jid` is the contact's routing_jid (falling back to jid). The worker persists the outbound
 * message (direction 'out') before responding.
 * 409 { error } if the account isn't connected; 404 if the account is unknown.
 */
export interface SendRequest {
  jid: string;
  text: string;
}
export interface SendResponse {
  message_id: string; // wa_messages.id
}

/** GET /health — public. */
export interface HealthResponse {
  ok: true;
  accounts: Array<{ id: string; status: WaAccountStatus }>;
}
