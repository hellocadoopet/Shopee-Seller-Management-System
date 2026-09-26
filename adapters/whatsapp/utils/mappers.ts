import type { Conversation, Message } from "../../types.js";
import type { WaMessageRow } from "../contract.js";
import type { ConversationWithContact } from "../api/store.js";

const toMs = (iso: string | null) => (iso ? Date.parse(iso) : null);

export function toConversation(c: ConversationWithContact): Conversation {
  const contact = c.contact;
  return {
    id: c.id,
    // Informational only — sends look the target up server-side (replyTarget), so a stale list can't misroute.
    peer_id: contact?.routing_jid ?? contact?.jid ?? "",
    peer_name: contact?.name ?? (contact?.phone_number ? `+${contact.phone_number}` : null),
    unread: c.unread_count,
    last_text: c.last_message_preview,
    last_at: toMs(c.last_message_at),
  };
}

/** `url` is the signed link to the file; null for text, history media, or files too big to download. */
export function toMessage(m: WaMessageRow, url: string | null): Message {
  return {
    id: m.id,
    from: m.direction === "out" ? "shop" : "customer",
    type: m.type,
    text: m.body,
    url,
    filename: m.media_filename,
    at: toMs(m.created_at) ?? 0,
  };
}
