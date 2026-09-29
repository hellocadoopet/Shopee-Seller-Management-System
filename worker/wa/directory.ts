/**
 * Who is who: the phone behind each hidden "@lid" id, and the names the linked phone knows people by.
 *
 * WhatsApp addresses a person by their phone jid in some chats and by an "@lid" privacy id in
 * others, and our own messages to an "@lid" never say whose phone it is. Messages alone can't
 * reliably tie the two together, so every pairing WhatsApp reveals anywhere (history-sync chats,
 * contact sync, phone-number shares, `senderPn` on incoming messages) is kept here — and each new
 * pairing merges the "@lid" contact into the phone contact, if both already exist.
 *
 * `learn` is queued per account; the `*Now` functions assume the caller already holds the queue.
 */
import { supabase } from "../../lib/supabase.js";
import type { WaContactRow, WaConversationRow, WaDirectoryRow } from "../../adapters/whatsapp/contract.js";
import { logger } from "../logger.js";
import { check, chunks, selectIn } from "./db.js";
import { jidToPhone } from "./parse.js";
import { previewOf } from "./persistence.js";
import { serialize } from "./queue.js";
import type { Identity } from "./session.js";

const UPSERT_CHUNK = 500;
const PAGE = 1000; // Supabase returns at most 1000 rows per request

/** lid → phone jid, per account. Filled on every learn/lookup; the table is the truth. */
const lidCache = new Map<string, Map<string, string>>();
const cacheOf = (accountId: string) => lidCache.get(accountId) ?? lidCache.set(accountId, new Map()).get(accountId)!;

const isLid = (j: string | null | undefined): j is string => !!j && j.endsWith("@lid");
const isPhone = (j: string | null | undefined): j is string => !!j && j.endsWith("@s.whatsapp.net");

export function learn(accountId: string, identities: Identity[]): Promise<void> {
  return serialize(accountId, () => learnNow(accountId, identities));
}

export async function learnNow(accountId: string, identities: Identity[]): Promise<void> {
  // One wanted row per id: an identity with both ids gives a row for its "@lid" and its phone.
  const want = new Map<string, WaDirectoryRow>();
  const add = (jid: string, i: Identity, pn: string | null) => {
    const cur = want.get(jid);
    want.set(jid, {
      account_id: accountId,
      jid,
      pn_jid: pn ?? cur?.pn_jid ?? null,
      saved_name: i.savedName || cur?.saved_name || null,
      push_name: i.pushName || cur?.push_name || null,
    });
  };
  for (const i of identities) {
    const pn = isPhone(i.pn) ? i.pn : null;
    if (isLid(i.lid)) add(i.lid, i, pn);
    if (pn) add(pn, i, pn);
  }
  if (!want.size) return;

  // Keep what we knew unless WhatsApp now says something new (a renamed contact updates).
  const known = new Map((await selectIn<WaDirectoryRow>("wa_directory", accountId, "jid", [...want.keys()])).map((r) => [r.jid, r]));
  const changed: WaDirectoryRow[] = [];
  const newPairs: Array<[lid: string, pn: string]> = [];
  for (const [jid, w] of want) {
    const k = known.get(jid);
    const next: WaDirectoryRow = {
      account_id: accountId,
      jid,
      pn_jid: w.pn_jid ?? k?.pn_jid ?? null,
      saved_name: w.saved_name ?? k?.saved_name ?? null,
      push_name: w.push_name ?? k?.push_name ?? null,
    };
    if (k && k.pn_jid === next.pn_jid && k.saved_name === next.saved_name && k.push_name === next.push_name) continue;
    changed.push(next);
    if (isLid(jid) && next.pn_jid && next.pn_jid !== k?.pn_jid) newPairs.push([jid, next.pn_jid]);
  }
  for (const part of chunks(changed, UPSERT_CHUNK)) {
    check(await supabase.from("wa_directory").upsert(part, { onConflict: "account_id,jid" }));
  }
  const cache = cacheOf(accountId);
  for (const r of changed) if (isLid(r.jid) && r.pn_jid) cache.set(r.jid, r.pn_jid);

  await mergePairs(accountId, newPairs);
  await applyNames(accountId, changed);
}

/** Phone jids for the given "@lid" ids, where known. */
export async function resolvePhones(accountId: string, lids: string[]): Promise<Map<string, string>> {
  const cache = cacheOf(accountId);
  const missing = [...new Set(lids.filter(isLid))].filter((l) => !cache.has(l));
  if (missing.length) {
    for (const r of await selectIn<WaDirectoryRow>("wa_directory", accountId, "jid", missing, "jid, pn_jid")) {
      if (r.pn_jid) cache.set(r.jid, r.pn_jid);
    }
  }
  return new Map(lids.flatMap((l) => (cache.has(l) ? [[l, cache.get(l)!] as const] : [])));
}

/** Directory names for new contacts: by phone jid first, then by "@lid". */
export async function namesFor(accountId: string, jids: string[]): Promise<Map<string, { saved: string | null; push: string | null }>> {
  const rows = await selectIn<WaDirectoryRow>("wa_directory", accountId, "jid", jids, "jid, pn_jid, saved_name, push_name");
  const out = new Map<string, { saved: string | null; push: string | null }>();
  for (const r of rows) {
    const key = r.pn_jid ?? r.jid;
    const cur = out.get(key);
    out.set(key, { saved: cur?.saved ?? r.saved_name, push: cur?.push ?? r.push_name });
    if (key !== r.jid) out.set(r.jid, out.get(key)!);
  }
  return out;
}

/** For each pairing's "@lid" contact: re-key it to the phone, or fold it into the phone's contact. */
async function mergePairs(accountId: string, pairs: Array<[string, string]>) {
  if (!pairs.length) return;
  const contacts = await selectIn<WaContactRow>("wa_contacts", accountId, "jid", pairs.flat());
  const byJid = new Map(contacts.map((c) => [c.jid, c]));
  let merged = 0, rekeyed = 0;
  for (const [lid, pn] of pairs) {
    const fromLid = byJid.get(lid);
    if (!fromLid) continue;
    const phone = byJid.get(pn);
    if (phone) {
      await mergeContact(accountId, fromLid, phone);
      merged++;
    } else {
      const patch = { jid: pn, phone_number: fromLid.phone_number ?? jidToPhone(pn), routing_jid: fromLid.routing_jid ?? lid };
      check(await supabase.from("wa_contacts").update(patch).eq("id", fromLid.id));
      byJid.set(pn, { ...fromLid, ...patch });
      rekeyed++;
    }
    byJid.delete(lid);
  }
  if (merged || rekeyed) logger.info({ accountId, merged, rekeyed }, "directory: joined @lid contacts to phone numbers");
}

/**
 * Two contacts turned out to be one person: move `from`'s messages into `into`'s conversation,
 * recompute its last message and unread, then drop `from`. Stored media keeps its object path.
 */
async function mergeContact(accountId: string, from: WaContactRow, into: WaContactRow) {
  type Conv = Pick<WaConversationRow, "id" | "contact_id" | "unread_count">;
  const convs = (check(
    await supabase.from("wa_conversations").select("id, contact_id, unread_count").eq("account_id", accountId).in("contact_id", [from.id, into.id]),
  ) ?? []) as Conv[];
  const fromConv = convs.find((c) => c.contact_id === from.id);
  const intoConv = convs.find((c) => c.contact_id === into.id);

  if (fromConv && !intoConv) {
    check(await supabase.from("wa_conversations").update({ contact_id: into.id }).eq("id", fromConv.id));
  } else if (fromConv && intoConv) {
    check(await supabase.from("wa_messages").update({ conversation_id: intoConv.id }).eq("account_id", accountId).eq("conversation_id", fromConv.id));
    const latest = check(
      await supabase.from("wa_messages").select("created_at, body, type").eq("conversation_id", intoConv.id).order("created_at", { ascending: false }).limit(1),
    ) as Array<{ created_at: string; body: string | null; type: string }> | null;
    const last = latest?.[0];
    check(
      await supabase
        .from("wa_conversations")
        .update({
          unread_count: intoConv.unread_count + fromConv.unread_count,
          ...(last ? { last_message_at: last.created_at, last_message_preview: previewOf(last) } : {}),
        })
        .eq("id", intoConv.id),
    );
    check(await supabase.from("wa_conversations").delete().eq("id", fromConv.id));
  }

  const keep: Partial<WaContactRow> = {};
  if (!into.routing_jid && from.routing_jid) keep.routing_jid = from.routing_jid;
  if (!into.name && from.name) keep.name = from.name;
  if (!into.saved_name && from.saved_name) keep.saved_name = from.saved_name;
  if (Object.keys(keep).length) check(await supabase.from("wa_contacts").update(keep).eq("id", into.id));
  check(await supabase.from("wa_contacts").delete().eq("id", from.id));
}

/** Changed directory names → the contacts they belong to (address-book name always; push name only if none yet). */
async function applyNames(accountId: string, rows: WaDirectoryRow[]) {
  const named = rows.filter((r) => r.saved_name || r.push_name);
  if (!named.length) return;
  const byKey = new Map<string, WaDirectoryRow>();
  for (const r of named) byKey.set(r.pn_jid ?? r.jid, { ...byKey.get(r.pn_jid ?? r.jid), ...r });
  const contacts = await selectIn<WaContactRow>("wa_contacts", accountId, "jid", [...byKey.keys()]);
  const patches = contacts.flatMap((c) => {
    const r = byKey.get(c.jid)!;
    const saved = r.saved_name && r.saved_name !== c.saved_name ? r.saved_name : c.saved_name;
    const name = c.name ?? r.push_name ?? null;
    return saved !== c.saved_name || name !== c.name ? [{ id: c.id, account_id: accountId, jid: c.jid, saved_name: saved, name }] : [];
  });
  for (const part of chunks(patches, UPSERT_CHUNK)) check(await supabase.from("wa_contacts").upsert(part, { onConflict: "id" }));
}

/**
 * Pairings already sitting in wa_contacts (a phone contact whose replies route to an "@lid") —
 * learning them merges any "@lid" duplicates created before the directory existed. Runs on resume.
 */
export function backfillFromContacts(accountId: string): Promise<void> {
  return serialize(accountId, async () => {
    const pairs: Identity[] = [];
    for (let from = 0; ; from += PAGE) {
      const rows = (check(
        await supabase
          .from("wa_contacts")
          .select("jid, routing_jid")
          .eq("account_id", accountId)
          .like("jid", "%@s.whatsapp.net")
          .like("routing_jid", "%@lid")
          .range(from, from + PAGE - 1),
      ) ?? []) as Array<{ jid: string; routing_jid: string }>;
      for (const r of rows) pairs.push({ lid: r.routing_jid, pn: r.jid, savedName: null, pushName: null });
      if (rows.length < PAGE) break;
    }
    await learnNow(accountId, pairs);
  });
}

/** True once the linked phone's address book has been received (any saved name stored). */
export async function hasAddressBook(accountId: string): Promise<boolean> {
  const { count } = await supabase
    .from("wa_directory")
    .select("jid", { count: "exact", head: true })
    .eq("account_id", accountId)
    .not("saved_name", "is", null);
  return (count ?? 0) > 0;
}
