/**
 * History sync → the same tables, in bulk. With syncFullHistory a phone sends thousands of
 * messages over several batches, so a batch costs a handful of requests per step (contacts,
 * conversations, message chunks) plus one update per touched conversation — never one round
 * trip per message. Queued with the account's live writes. History never bumps unread.
 */
import { supabase } from "../../lib/supabase.js";
import type { WaContactRow, WaConversationRow } from "../../adapters/whatsapp/contract.js";
import { check, chunks, selectIn } from "./db.js";
import { learnNow, namesFor, resolvePhones } from "./directory.js";
import { logger } from "../logger.js";
import { isDirectChat, jidToPhone } from "./parse.js";
import { messageColumns, previewOf } from "./persistence.js";
import { serialize } from "./queue.js";
import type { Envelope } from "./session.js";

const INSERT_CHUNK = 500;

export interface HistoryResult {
  received: number;
  inserted: number;
  conversations: number;
}

export function persistHistory(accountId: string, batch: Envelope[]): Promise<HistoryResult> {
  return serialize(accountId, () => persistNow(accountId, batch));
}

const unique = <T>(xs: T[]) => [...new Set(xs)];

async function persistNow(accountId: string, batch: Envelope[]): Promise<HistoryResult> {
  const byId = new Map<string, Envelope>();
  for (const e of batch) if (isDirectChat(e.routingJid)) byId.set(e.waMessageId, e);
  const envs = [...byId.values()];
  if (!envs.length) return { received: batch.length, inserted: 0, conversations: 0 };

  // ── Contacts ── keyed like the live path: phone jid when known, so "@lid" chats merge.
  // Pairings this batch reveals (senderPn) go into the directory first — which also merges any
  // "@lid" contact an earlier batch created — then every "@lid" is looked up there, so our own
  // messages to an "@lid" (which never name the phone) join the person's phone contact.
  const lidToPhone = new Map<string, string>();
  for (const e of envs) if (e.routingJid.endsWith("@lid") && e.canonicalJid !== e.routingJid) lidToPhone.set(e.routingJid, e.canonicalJid);
  // Never lets a directory failure (e.g. migration 003 not run) stop the batch being saved.
  const optional = <T>(p: Promise<T>, fallback: T) =>
    p.catch((err) => (logger.warn({ accountId, err: String(err) }, "directory unavailable — history saved without it"), fallback));
  await optional(learnNow(accountId, [...lidToPhone].map(([lid, pn]) => ({ lid, pn, savedName: null, pushName: null }))), undefined);
  const lids = unique(envs.map((e) => e.canonicalJid).filter((j) => j.endsWith("@lid")));
  for (const [lid, pn] of await optional(resolvePhones(accountId, lids), new Map<string, string>())) lidToPhone.set(lid, pn);
  const phoneToLid = new Map([...lidToPhone].map(([lid, phone]) => [phone, lid]));
  const keyOf = (e: Envelope) => lidToPhone.get(e.canonicalJid) ?? e.canonicalJid;

  const groups = new Map<string, Envelope[]>();
  for (const e of envs) groups.set(keyOf(e), [...(groups.get(keyOf(e)) ?? []), e]);
  const keys = [...groups.keys()];
  const lidKeys = keys.filter((k) => k.endsWith("@lid"));

  const byJid = new Map<string, WaContactRow>();
  const byRouting = new Map<string, WaContactRow>();
  const found = [
    ...(await selectIn<WaContactRow>("wa_contacts", accountId, "jid", [...keys, ...lidToPhone.keys()])),
    ...(await selectIn<WaContactRow>("wa_contacts", accountId, "routing_jid", lidKeys)),
  ];
  for (const c of found) {
    byJid.set(c.jid, c);
    if (c.routing_jid) byRouting.set(c.routing_jid, c);
  }

  const contactOf = new Map<string, WaContactRow>(); // group key → contact
  for (const k of keys) {
    const direct = byJid.get(k) ?? (k.endsWith("@lid") ? byRouting.get(k) : undefined);
    if (direct) {
      contactOf.set(k, direct);
      continue;
    }
    // Phone learned for a contact we so far only knew by its "@lid": re-key it (few per batch).
    const lid = phoneToLid.get(k);
    const lidContact = lid ? byJid.get(lid) : undefined;
    if (lidContact) {
      check(await supabase.from("wa_contacts").update({ jid: k, phone_number: lidContact.phone_number ?? jidToPhone(k) }).eq("id", lidContact.id));
      contactOf.set(k, { ...lidContact, jid: k });
    }
  }

  const newKeys = keys.filter((k) => !contactOf.has(k));
  const dirNames = await optional(namesFor(accountId, [...newKeys, ...newKeys.map((k) => phoneToLid.get(k)).filter((x): x is string => !!x)]), new Map());
  const newRows = newKeys.map((k) => {
    const msgs = [...groups.get(k)!].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const latestIn = msgs.find((m) => m.direction === "in");
    const dir = dirNames.get(k);
    return {
      account_id: accountId,
      jid: k,
      routing_jid: (latestIn ?? msgs[0]!).routingJid,
      name: msgs.find((m) => m.pushName)?.pushName ?? dir?.push ?? null,
      saved_name: dir?.saved ?? null,
      phone_number: jidToPhone(k),
    };
  });
  for (const part of chunks(newRows, INSERT_CHUNK)) {
    const rows = check(
      await supabase.from("wa_contacts").upsert(part, { onConflict: "account_id,jid", ignoreDuplicates: true }).select("*"),
    ) as WaContactRow[] | null;
    for (const c of rows ?? []) contactOf.set(c.jid, c);
  }
  const stillMissing = keys.filter((k) => !contactOf.has(k));
  if (stillMissing.length) {
    for (const c of await selectIn<WaContactRow>("wa_contacts", accountId, "jid", stillMissing)) contactOf.set(c.jid, c);
  }

  // ── Conversations ──
  type Conv = Pick<WaConversationRow, "id" | "contact_id" | "last_message_at">;
  const convCols = "id, contact_id, last_message_at";
  const contactIds = unique(keys.map((k) => contactOf.get(k)?.id).filter((x): x is string => !!x));
  const convOf = new Map<string, Conv>(); // contact_id → conversation
  for (const c of await selectIn<Conv>("wa_conversations", accountId, "contact_id", contactIds, convCols)) convOf.set(c.contact_id, c);
  const newConvs = contactIds.filter((id) => !convOf.has(id)).map((contact_id) => ({ account_id: accountId, contact_id, unread_count: 0 }));
  for (const part of chunks(newConvs, INSERT_CHUNK)) {
    const rows = check(
      await supabase.from("wa_conversations").upsert(part, { onConflict: "account_id,contact_id", ignoreDuplicates: true }).select(convCols),
    ) as Conv[] | null;
    for (const c of rows ?? []) convOf.set(c.contact_id, c);
  }
  const convMissing = contactIds.filter((id) => !convOf.has(id));
  if (convMissing.length) {
    for (const c of await selectIn<Conv>("wa_conversations", accountId, "contact_id", convMissing, convCols)) convOf.set(c.contact_id, c);
  }

  // ── Messages ── duplicates (already stored live or by an earlier batch) are skipped by the unique key.
  const convIdOf = (e: Envelope) => convOf.get(contactOf.get(keyOf(e))?.id ?? "")?.id;
  const rows = envs.flatMap((e) => {
    const conversation_id = convIdOf(e);
    return conversation_id ? [{ conversation_id, account_id: accountId, ...messageColumns(e) }] : [];
  });
  const insertedIds = new Set<string>();
  for (const part of chunks(rows, INSERT_CHUNK)) {
    const ins = check(
      await supabase.from("wa_messages").upsert(part, { onConflict: "account_id,wa_message_id", ignoreDuplicates: true }).select("wa_message_id"),
    ) as Array<{ wa_message_id: string }> | null;
    for (const r of ins ?? []) insertedIds.add(r.wa_message_id);
  }

  // ── Aggregates ── only move last_message forward; unread is untouched.
  const newest = new Map<string, Envelope>(); // conversation id → newest inserted message
  for (const e of envs) {
    const id = convIdOf(e);
    if (!id || !insertedIds.has(e.waMessageId)) continue;
    const cur = newest.get(id);
    if (!cur || e.timestamp > cur.timestamp) newest.set(id, e);
  }
  const stored = new Map([...convOf.values()].map((c) => [c.id, c.last_message_at]));
  for (const [id, e] of newest) {
    const last = stored.get(id);
    if (last && e.timestamp.getTime() < Date.parse(last)) continue;
    check(
      await supabase
        .from("wa_conversations")
        .update({ last_message_at: e.timestamp.toISOString(), last_message_preview: previewOf(e) })
        .eq("id", id),
    );
  }

  // ── Routing ── replies go where their newest incoming message came from. A history batch only
  // moves it forward: its newest inbound must be newer than anything the conversation had before.
  for (const k of keys) {
    const contact = contactOf.get(k);
    const newestIn = groups.get(k)!.filter((e) => e.direction === "in").sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
    if (!contact || !newestIn || newestIn.routingJid === contact.routing_jid) continue;
    const conv = convOf.get(contact.id);
    const before = conv ? stored.get(conv.id) : null;
    if (before && newestIn.timestamp.getTime() < Date.parse(before)) continue;
    check(await supabase.from("wa_contacts").update({ routing_jid: newestIn.routingJid }).eq("id", contact.id));
  }

  return { received: batch.length, inserted: insertedIds.size, conversations: newest.size };
}
