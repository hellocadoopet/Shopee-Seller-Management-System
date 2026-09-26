/**
 * Messages → wa_contacts / wa_conversations / wa_messages. Everything for one account goes
 * through its queue (see queue.ts), so the read-then-write steps below never interleave.
 */
import { supabase } from "../../lib/supabase.js";
import type { WaContactRow, WaConversationRow, WaMessageRow } from "../../adapters/whatsapp/contract.js";
import { isDirectChat, jidToPhone } from "./parse.js";
import { check } from "./db.js";
import { serialize } from "./queue.js";
import type { Envelope, ReceiptStatus } from "./session.js";

export interface Persisted {
  messageId: string;
  conversationId: string;
  /** false = we already had this wa_message_id (Baileys redelivers); nothing was changed. */
  inserted: boolean;
}

/** Idempotent on (account_id, wa_message_id). Returns null for chats we don't store (groups etc). */
export function persistMessage(accountId: string, env: Envelope): Promise<Persisted | null> {
  return serialize(accountId, () => persistNow(accountId, env));
}

/** Our reply, sent through the socket just now. Returns its wa_messages.id. */
export async function persistOutbound(accountId: string, waMessageId: string, toJid: string, text: string): Promise<string> {
  const saved = await persistMessage(accountId, {
    waMessageId,
    routingJid: toJid,
    canonicalJid: toJid, // an "@lid" target is mapped back to its merged contact in upsertContact
    pushName: null,
    body: text,
    type: "text",
    media: null,
    direction: "out",
    timestamp: new Date(),
    isHistory: false,
  });
  if (!saved) throw new Error("Not a 1:1 chat jid");
  return saved.messageId;
}

const RANK: Record<ReceiptStatus, number> = { failed: 0, sent: 1, delivered: 2, read: 3 };

/** Delivery/read receipt for one of our messages. Never downgrades (a late "delivered" after "read"). */
export function applyReceipt(accountId: string, waMessageId: string, status: ReceiptStatus): Promise<boolean> {
  return serialize(accountId, async () => {
    const row = check(
      await supabase
        .from("wa_messages")
        .select("id, status")
        .eq("account_id", accountId)
        .eq("wa_message_id", waMessageId)
        .eq("direction", "out")
        .maybeSingle(),
    ) as Pick<WaMessageRow, "id" | "status"> | null;
    if (!row) return false;
    if (row.status && row.status !== "failed" && RANK[status] <= RANK[row.status]) return false;
    check(await supabase.from("wa_messages").update({ status }).eq("id", row.id));
    return true;
  });
}

async function persistNow(accountId: string, env: Envelope): Promise<Persisted | null> {
  if (!isDirectChat(env.routingJid)) return null;

  // Cheap pre-check so a redelivered message doesn't touch the contact (e.g. its routing_jid).
  const seen = await findMessage(accountId, env.waMessageId);
  if (seen) return { messageId: seen.id, conversationId: seen.conversation_id, inserted: false };

  const contact = await upsertContact(accountId, env);
  const conversation = await ensureConversation(accountId, contact.id);

  // The unique (account_id, wa_message_id) is the real dedupe; ignoreDuplicates returns no row on conflict.
  const inserted = check(
    await supabase
      .from("wa_messages")
      .upsert(
        {
          conversation_id: conversation.id,
          account_id: accountId,
          ...messageColumns(env),
        },
        { onConflict: "account_id,wa_message_id", ignoreDuplicates: true },
      )
      .select("id"),
  ) as Array<{ id: string }> | null;
  const row = inserted?.[0];
  if (!row) {
    const existing = await findMessage(accountId, env.waMessageId);
    if (!existing) throw new Error("wa_messages insert returned nothing");
    return { messageId: existing.id, conversationId: existing.conversation_id, inserted: false };
  }

  await bumpConversation(conversation.id, env);
  if (!env.isHistory) {
    check(await supabase.from("wa_accounts").update({ last_seen_at: new Date().toISOString() }).eq("id", accountId));
  }
  return { messageId: row.id, conversationId: conversation.id, inserted: true };
}

async function findMessage(accountId: string, waMessageId: string) {
  return check(
    await supabase
      .from("wa_messages")
      .select("id, conversation_id")
      .eq("account_id", accountId)
      .eq("wa_message_id", waMessageId)
      .maybeSingle(),
  ) as Pick<WaMessageRow, "id" | "conversation_id"> | null;
}

async function findContact(accountId: string, column: "jid" | "routing_jid", value: string) {
  const rows = check(
    await supabase.from("wa_contacts").select("*").eq("account_id", accountId).eq(column, value).limit(1),
  ) as WaContactRow[] | null;
  return rows?.[0] ?? null;
}

/**
 * One contact per person, keyed by the canonical (phone) jid, so an "@lid" chat and the
 * phone-number chat merge. routing_jid follows the latest INBOUND message — that's where their
 * Signal session is, so replies must go there.
 */
async function upsertContact(accountId: string, env: Envelope): Promise<WaContactRow> {
  let contact = await findContact(accountId, "jid", env.canonicalJid);

  // No phone for this "@lid" (our own messages never carry senderPn): use the contact we
  // already merged under it.
  if (!contact && env.canonicalJid.endsWith("@lid")) contact = await findContact(accountId, "routing_jid", env.canonicalJid);

  // First time we learn the phone behind an "@lid" contact: re-key it instead of making a second one.
  let rekey = false;
  if (!contact && env.routingJid.endsWith("@lid") && env.canonicalJid !== env.routingJid) {
    contact = await findContact(accountId, "jid", env.routingJid);
    rekey = !!contact;
  }

  if (!contact) {
    return check(
      await supabase
        .from("wa_contacts")
        .insert({
          account_id: accountId,
          jid: env.canonicalJid,
          routing_jid: env.routingJid,
          name: env.pushName,
          phone_number: jidToPhone(env.canonicalJid),
        })
        .select("*")
        .single(),
    ) as WaContactRow;
  }

  const patch: Partial<WaContactRow> = {};
  if (rekey) patch.jid = env.canonicalJid;
  if (env.direction === "in" && contact.routing_jid !== env.routingJid) patch.routing_jid = env.routingJid;
  if (!contact.name && env.pushName) patch.name = env.pushName;
  if (!contact.phone_number) {
    const phone = jidToPhone(env.canonicalJid);
    if (phone) patch.phone_number = phone;
  }
  if (!Object.keys(patch).length) return contact;
  check(await supabase.from("wa_contacts").update(patch).eq("id", contact.id));
  return { ...contact, ...patch };
}

async function ensureConversation(accountId: string, contactId: string): Promise<Pick<WaConversationRow, "id">> {
  const rows = check(
    await supabase.from("wa_conversations").select("id").eq("account_id", accountId).eq("contact_id", contactId).limit(1),
  ) as Array<{ id: string }> | null;
  if (rows?.[0]) return rows[0];
  return check(
    await supabase.from("wa_conversations").insert({ account_id: accountId, contact_id: contactId, unread_count: 0 }).select("id").single(),
  ) as { id: string };
}

/**
 * Only called when the message row was really inserted. Re-reads the row right before writing to
 * keep the window small: the dashboard also writes unread_count (resets it when a chat is opened).
 */
async function bumpConversation(conversationId: string, env: Envelope) {
  const conv = check(
    await supabase.from("wa_conversations").select("last_message_at, unread_count").eq("id", conversationId).single(),
  ) as Pick<WaConversationRow, "last_message_at" | "unread_count">;

  const patch: Partial<WaConversationRow> = {};
  // Never move "last message" backwards — history batches arrive after newer live messages.
  if (!conv.last_message_at || env.timestamp.getTime() >= Date.parse(conv.last_message_at)) {
    patch.last_message_at = env.timestamp.toISOString();
    patch.last_message_preview = previewOf(env);
  }
  if (env.direction === "in" && !env.isHistory) patch.unread_count = conv.unread_count + 1;
  if (Object.keys(patch).length) check(await supabase.from("wa_conversations").update(patch).eq("id", conversationId));
}

/** The wa_messages columns that come straight from the envelope. media_path is set later (media.ts). */
export function messageColumns(env: Envelope) {
  return {
    wa_message_id: env.waMessageId,
    direction: env.direction,
    type: env.type,
    body: env.body,
    media_mime: env.media?.mime ?? null,
    media_filename: env.type === "document" ? (env.media?.filename ?? null) : null,
    status: env.direction === "out" ? "sent" : null,
    created_at: env.timestamp.toISOString(),
  };
}

export function previewOf(env: Envelope): string {
  const text = env.body?.trim() || (env.type === "text" ? "" : `[${env.type}]`);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}
