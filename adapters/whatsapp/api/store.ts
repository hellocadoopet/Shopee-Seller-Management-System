// Reads of the tables the worker writes (db/migrations/002_whatsapp.sql). Every query is scoped
// to the account, so a conversation id from the browser can't reach another number's chats.
import { supabase } from "../../../lib/supabase.js";
import { MEDIA_BUCKET, type WaContactRow, type WaConversationRow, type WaMessageRow } from "../contract.js";

export type ConversationWithContact = WaConversationRow & {
  contact: Pick<WaContactRow, "jid" | "routing_jid" | "name" | "saved_name" | "phone_number"> | null;
};

const PAGE_SIZE = 60;
const THREAD_LIMIT = 300; // newest messages shown per thread
const MEDIA_URL_TTL_SECONDS = 6 * 3600; // the thread page caches each URL, so it must outlive a long session

export async function listConversations(accountId: string, unreadOnly: boolean): Promise<ConversationWithContact[]> {
  let q = supabase
    .from("wa_conversations")
    .select("id, account_id, contact_id, last_message_at, last_message_preview, unread_count, contact:wa_contacts(jid, routing_jid, name, saved_name, phone_number)")
    .eq("account_id", accountId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(PAGE_SIZE);
  if (unreadOnly) q = q.gt("unread_count", 0);
  const { data, error } = await q;
  if (error) throw new Error(`whatsapp conversations: ${error.message}`);
  return (data ?? []) as unknown as ConversationWithContact[];
}

/** Newest THREAD_LIMIT messages, oldest first. */
export async function listMessages(accountId: string, conversationId: string): Promise<WaMessageRow[]> {
  const { data, error } = await supabase
    .from("wa_messages")
    .select("id, conversation_id, account_id, wa_message_id, direction, type, body, media_path, media_mime, media_filename, status, created_at")
    .eq("account_id", accountId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(THREAD_LIMIT);
  if (error) throw new Error(`whatsapp messages: ${error.message}`);
  return ((data ?? []) as WaMessageRow[]).reverse();
}

/** Signed, expiring URLs for the messages' files, keyed by media_path. The bucket itself is private. */
export async function signMediaUrls(messages: WaMessageRow[]): Promise<Map<string, string>> {
  const paths = messages.flatMap((m) => (m.media_path ? [m.media_path] : []));
  if (!paths.length) return new Map();
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(paths, MEDIA_URL_TTL_SECONDS);
  if (error) throw new Error(`whatsapp media urls: ${error.message}`);
  return new Map((data ?? []).flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])));
}

/** Opening a thread reads it (in the dashboard only — no read receipt goes to the customer). */
export async function markRead(accountId: string, conversationId: string) {
  const { error } = await supabase.from("wa_conversations").update({ unread_count: 0 }).eq("account_id", accountId).eq("id", conversationId);
  if (error) throw new Error(`whatsapp mark read: ${error.message}`);
}

/** Numbers whose link is gone (device removed, login lost) — they need a fresh QR scan. */
export async function loggedOutAccounts(): Promise<string[]> {
  const { data, error } = await supabase.from("wa_accounts").select("id").eq("status", "logged_out");
  if (error) throw new Error(`whatsapp accounts: ${error.message}`);
  return (data ?? []).map((a) => a.id as string);
}

/** Where a reply must go: the jid their latest message came from, else the canonical one. */
export async function replyTarget(accountId: string, conversationId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("wa_conversations")
    .select("contact:wa_contacts(jid, routing_jid)")
    .eq("account_id", accountId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(`whatsapp reply target: ${error.message}`);
  const contact = (data as { contact: { jid: string; routing_jid: string | null } | null } | null)?.contact;
  return contact ? (contact.routing_jid ?? contact.jid) : null;
}
