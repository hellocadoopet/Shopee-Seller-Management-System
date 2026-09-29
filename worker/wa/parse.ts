/** Baileys message shapes → Envelope. Pure functions, no socket. */
import { jidNormalizedUser, normalizeMessageContent, type Contact, type WAMessage, type WAMessageContent } from "@whiskeysockets/baileys";
import type { WaMessageType } from "../../adapters/whatsapp/contract.js";
import type { Envelope, Identity, ReceiptStatus } from "./session.js";

/** 1:1 chats only: phone jids and "@lid" privacy jids. Groups, status, broadcasts, newsletters are skipped. */
export function isDirectChat(jid: string | null | undefined): jid is string {
  return !!jid && (jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"));
}

/** "60123456789@s.whatsapp.net" or "60123456789:12@s.whatsapp.net" → "60123456789". "@lid" ids aren't phones. */
export function jidToPhone(jid: string): string | null {
  return /^(\d+)(?::\d+)?@s\.whatsapp\.net$/.exec(jid)?.[1] ?? null;
}

const isPhoneJid = (j: string | null | undefined): j is string => !!j && j.endsWith("@s.whatsapp.net");
const isLidJid = (j: string | null | undefined): j is string => !!j && j.endsWith("@lid");
/** Drops a device suffix ("60123:12@s.whatsapp.net" → "60123@s.whatsapp.net"). */
const norm = (j: string | null | undefined) => (j ? jidNormalizedUser(j) || null : null);

/**
 * A contact record (contact sync / history sync / contacts.update) → who it is. `name` is the
 * linked phone's address-book name; `notify` is the name they set themselves. `id` is either id.
 */
export function identityOfContact(c: Partial<Contact>): Identity | null {
  const pn = [c.jid, c.id].map(norm).find(isPhoneJid) ?? null;
  const lid = [c.lid, c.id].map(norm).find(isLidJid) ?? null;
  if (!pn && !lid) return null;
  return { pn, lid, savedName: c.name || null, pushName: c.notify || null };
}

/** A history-sync chat → who it's with. 1:1 chats carry both ids (pnJid / lidJid) and the chat's name. */
export function identityOfChat(chat: { id?: string | null; pnJid?: string | null; lidJid?: string | null; name?: string | null }): Identity | null {
  const id = norm(chat.id);
  const pn = norm(chat.pnJid) ?? (isPhoneJid(id) ? id : null);
  const lid = norm(chat.lidJid) ?? (isLidJid(id) ? id : null);
  if (!isPhoneJid(pn) && !isLidJid(lid)) return null;
  return { pn: isPhoneJid(pn) ? pn : null, lid: isLidJid(lid) ? lid : null, savedName: chat.name || null, pushName: null };
}

/**
 * For "@lid" chats WhatsApp includes the real phone jid in key.senderPn. Keying the contact by it
 * merges the hidden-id chat with the phone-number chat; replies still go to the "@lid" jid.
 */
export function canonicalJidFor(key: WAMessage["key"]): string | null {
  const jid = key.remoteJid;
  if (!jid) return null;
  if (jid.endsWith("@lid") && key.senderPn?.endsWith("@s.whatsapp.net")) return key.senderPn;
  return jid;
}

// Content we show as an "other" bubble. Anything not listed (reactions, protocol/edit/revoke
// messages, key distribution, poll votes…) is not a chat message and is skipped.
const OTHER_KINDS: Array<keyof WAMessageContent> = [
  "locationMessage", "liveLocationMessage", "contactMessage", "contactsArrayMessage",
  "pollCreationMessage", "pollCreationMessageV2", "pollCreationMessageV3",
  "listMessage", "buttonsMessage", "templateMessage", "productMessage", "orderMessage",
];

type Content = Pick<Envelope, "type" | "body" | "media">;

const num = (v: unknown) => (v == null ? null : Number(v));

/** Type + body (text or caption) + media metadata, or null if this isn't a chat message. */
export function readContent(m: WAMessage): Content | null {
  // Peels ephemeral / view-once / document-with-caption wrappers so disappearing messages aren't blank.
  const c = normalizeMessageContent(m.message);
  if (!c) return null;
  const text = c.conversation || c.extendedTextMessage?.text;
  if (text) return { type: "text", body: text, media: null };
  const media = (
    type: WaMessageType,
    x: { mimetype?: string | null; fileLength?: unknown; caption?: string | null; fileName?: string | null },
  ): Content => ({
    type,
    body: x.caption || null,
    media: { mime: x.mimetype || null, filename: x.fileName || null, size: num(x.fileLength) },
  });
  if (c.imageMessage) return media("image", c.imageMessage);
  if (c.videoMessage) return media("video", c.videoMessage);
  if (c.ptvMessage) return media("video", c.ptvMessage); // round video note
  if (c.audioMessage) return media("audio", c.audioMessage); // incl. voice notes
  if (c.documentMessage) return media("document", c.documentMessage);
  if (c.stickerMessage) return media("sticker", c.stickerMessage);
  if (OTHER_KINDS.some((k) => c[k])) return { type: "other", body: null, media: null };
  return null;
}

export function toEnvelope(m: WAMessage, isHistory: boolean): Envelope | null {
  const id = m.key.id;
  const routingJid = m.key.remoteJid;
  if (!id || !isDirectChat(routingJid)) return null;
  const content = readContent(m);
  if (!content) return null;
  const fromMe = !!m.key.fromMe;
  const tsMs = Number(m.messageTimestamp ?? 0) * 1000;
  return {
    waMessageId: id,
    routingJid,
    canonicalJid: canonicalJidFor(m.key) ?? routingJid,
    // On our own messages pushName is OUR name — never store it on the contact.
    pushName: fromMe ? null : m.pushName || null,
    ...content,
    direction: fromMe ? "out" : "in",
    timestamp: tsMs > 0 ? new Date(tsMs) : new Date(),
    isHistory,
  };
}

/** One messaging-history.set batch → envelopes. No cutoff or cap: persistence writes it in bulk. */
export function historyEnvelopes(messages: WAMessage[]): Envelope[] {
  return messages.flatMap((m) => toEnvelope(m, true) ?? []);
}

/**
 * proto.WebMessageInfo.Status: ERROR=0 PENDING=1 SERVER_ACK=2 DELIVERY_ACK=3 READ=4 PLAYED=5.
 * (The source app mapped these off by one — it showed "delivered" for a server ack.)
 */
export function receiptStatus(n: number): ReceiptStatus | null {
  if (n === 0) return "failed";
  if (n === 2) return "sent";
  if (n === 3) return "delivered";
  if (n >= 4) return "read";
  return null;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/3gpp": "3gp", "video/quicktime": "mov",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr",
  "application/pdf": "pdf",
};

/** File extension for a Storage path, from the mime type ("audio/ogg; codecs=opus" → "ogg"). */
export function extFor(mime: string | null, filename: string | null): string {
  const base = mime?.split(";")[0]?.trim().toLowerCase() ?? "";
  const known = EXT[base];
  if (known) return known;
  const fromName = filename?.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  const sub = base.split("/")[1]?.replace(/[^a-z0-9]/g, "");
  return sub && sub.length <= 8 ? sub : "bin";
}
