/**
 * Offline check of the worker: persistence, pairing, send, auth, media, history — with an
 * in-memory fake of Supabase (PostgREST + Storage, via globalThis.fetch) and a fake session in
 * place of Baileys. No network, no WhatsApp.   Run: cd worker && npm run check
 */
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WAMessage } from "@whiskeysockets/baileys";
import type { Envelope, SessionEvents, SessionStatus, WaSession } from "../wa/session.js";

// Env first: lib/config reads it at import time, so the modules under test are imported below.
process.env.SUPABASE_URL = "http://fake-supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role";
process.env.LOG_LEVEL ??= "silent";

// ─── Fake Supabase ───

type Row = Record<string, unknown>;
const SCHEMA: Record<string, { unique: string[][]; fk?: Record<string, string>; defaults?: () => Row }> = {
  shops: { unique: [["id"], ["platform", "external_id"]], defaults: () => ({ region: "MY", connected_at: new Date().toISOString(), disconnected_at: null }) },
  wa_accounts: { unique: [["id"], ["shop_id"]], fk: { shop_id: "shops" }, defaults: () => ({ status: "connecting", last_seen_at: null, created_at: new Date().toISOString() }) },
  wa_contacts: { unique: [["id"], ["account_id", "jid"]], fk: { account_id: "wa_accounts" }, defaults: () => ({ routing_jid: null, name: null, phone_number: null }) },
  wa_conversations: {
    unique: [["id"], ["account_id", "contact_id"]],
    fk: { account_id: "wa_accounts", contact_id: "wa_contacts" },
    defaults: () => ({ last_message_at: null, last_message_preview: null, unread_count: 0 }),
  },
  wa_messages: {
    unique: [["id"], ["account_id", "wa_message_id"]],
    fk: { account_id: "wa_accounts", conversation_id: "wa_conversations" },
    defaults: () => ({ type: "text", body: null, media_path: null, media_mime: null, media_filename: null, status: null, created_at: new Date().toISOString() }),
  },
};
const db: Record<string, Row[]> = Object.fromEntries(Object.keys(SCHEMA).map((t) => [t, []]));
const storage = { buckets: new Set<string>(), objects: new Map<string, { bytes: number; contentType: string | null }>() };
const requests: Array<{ method: string; table: string }> = [];
const insertOrder: string[] = [];

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function matches(row: Row, params: URLSearchParams) {
  for (const [col, expr] of params) {
    if (["select", "on_conflict", "columns", "limit", "order", "offset"].includes(col)) continue;
    const dot = expr.indexOf(".");
    const op = expr.slice(0, dot);
    const val = expr.slice(dot + 1);
    const cell = row[col];
    if (op === "eq" && String(cell) !== val) return false;
    if (op === "neq" && String(cell) === val) return false;
    if (op === "is" && val === "null" && cell != null) return false;
    if (op === "in") {
      const list = val.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, ""));
      if (!list.includes(String(cell))) return false;
    }
  }
  return true;
}

function conflictOf(table: string, row: Row, keys?: string[]) {
  const sets = keys ? [keys] : SCHEMA[table]!.unique;
  for (const cols of sets) {
    const hit = db[table]!.find((r) => cols.every((c) => row[c] != null && r[c] === row[c]));
    if (hit) return hit;
  }
  return null;
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);

  if (url.pathname.startsWith("/storage/v1/")) {
    requests.push({ method, table: "storage" });
    const rest = url.pathname.slice("/storage/v1/".length);
    if (rest === "bucket" && method === "POST") {
      const { id } = JSON.parse(String(init?.body)) as { id: string };
      if (storage.buckets.has(id)) return json(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      storage.buckets.add(id);
      return json(200, { name: id });
    }
    const m = /^object\/([^/]+)\/(.+)$/.exec(rest);
    if (m && method === "POST") {
      const [, bucket, path] = m;
      if (!storage.buckets.has(bucket!)) return json(404, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
      const body = init?.body as Buffer | Uint8Array | undefined;
      storage.objects.set(`${bucket}/${decodeURIComponent(path!)}`, { bytes: body?.byteLength ?? 0, contentType: headers.get("content-type") });
      return json(200, { Id: "obj", Key: `${bucket}/${path}` });
    }
    return json(404, { message: `fake storage: unsupported ${method} ${rest}` });
  }

  const table = url.pathname.replace(/^\/rest\/v1\//, "");
  const schema = SCHEMA[table];
  if (!schema) return json(404, { message: `fake: unknown table ${table}` });
  requests.push({ method, table });
  const prefer = headers.get("prefer") ?? "";
  const single = (headers.get("accept") ?? "").includes("vnd.pgrst.object+json");
  const wantRows = prefer.includes("return=representation") || method === "GET";

  const respond = (rows: Row[], status = 200) => {
    if (!wantRows) return new Response(null, { status: 204 });
    if (!single) return json(status, rows);
    if (rows.length !== 1) return json(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: null, hint: null });
    return json(status, rows[0]);
  };

  if (method === "GET") {
    let rows = db[table]!.filter((r) => matches(r, url.searchParams));
    const limit = url.searchParams.get("limit");
    if (limit) rows = rows.slice(0, Number(limit));
    return respond(rows);
  }

  if (method === "PATCH") {
    const patch = JSON.parse(String(init?.body)) as Row;
    const rows = db[table]!.filter((r) => matches(r, url.searchParams));
    for (const r of rows) Object.assign(r, patch);
    return respond(rows);
  }

  if (method === "POST") {
    const body = JSON.parse(String(init?.body)) as Row | Row[];
    const input = Array.isArray(body) ? body : [body];
    const onConflict = url.searchParams.get("on_conflict")?.split(",");
    const resolution = /resolution=(merge|ignore)-duplicates/.exec(prefer)?.[1];
    const out: Row[] = [];
    for (const raw of input) {
      const row: Row = { id: crypto.randomUUID(), ...schema.defaults?.(), ...raw };
      for (const [col, ref] of Object.entries(schema.fk ?? {})) {
        if (!db[ref]!.some((r) => r.id === row[col])) {
          return json(409, { code: "23503", message: `insert on ${table} violates foreign key ${col} → ${ref}`, details: null, hint: null });
        }
      }
      const hit = conflictOf(table, row, resolution ? onConflict : undefined) ?? (resolution ? null : conflictOf(table, row));
      if (hit) {
        if (resolution === "ignore") continue;
        if (resolution === "merge") {
          Object.assign(hit, raw);
          out.push(hit);
          continue;
        }
        return json(409, { code: "23505", message: `duplicate key value violates unique constraint on ${table}`, details: null, hint: null });
      }
      db[table]!.push(row);
      insertOrder.push(table);
      out.push(row);
    }
    return respond(out, 201);
  }
  return json(405, { message: "fake: method not allowed" });
}
globalThis.fetch = fakeFetch as typeof fetch;

// ─── Modules under test (after env + fetch are in place) ───

const { createApp } = await import("../http.js");
const { SessionManager } = await import("../wa/manager.js");
const { drain } = await import("../wa/queue.js");
const { ensureMediaBucket } = await import("../wa/media.js");
const { toEnvelope, receiptStatus } = await import("../wa/parse.js");
const { MEDIA_BUCKET, MEDIA_MAX_BYTES, mediaObjectPath } = await import("../../adapters/whatsapp/contract.js");

// ─── Fake session ───

let sendCounter = 0;
class FakeSession extends EventEmitter<SessionEvents> implements WaSession {
  status: SessionStatus = "connecting";
  everConnected = false;
  alive = true;
  pending = false;
  started = 0;
  stopped = false;
  sent: Array<{ jid: string; text: string }> = [];
  /** Emit the "append" echo of our own send before resolving, like Baileys does. */
  echo = false;
  constructor(
    readonly accountId: string,
    readonly dir: string,
  ) {
    super();
  }
  isAlive() {
    return this.status === "connected" && this.alive;
  }
  reconnectPending() {
    return this.pending;
  }
  async start() {
    this.started++;
  }
  async stop() {
    this.stopped = true;
    this.status = "disconnected";
  }
  async sendText(jid: string, text: string) {
    if (this.status !== "connected") throw new Error("not connected");
    this.sent.push({ jid, text });
    const id = `OUT-${++sendCounter}`;
    if (this.echo) this.emit("message", env({ waMessageId: id, routingJid: jid, direction: "out", body: text }));
    return id;
  }
  setStatus(s: SessionStatus) {
    this.status = s;
    this.emit("status", s);
  }
  connect(phoneNumber: string | null) {
    this.everConnected = true;
    this.setStatus("connected");
    this.emit("connected", { phoneNumber });
  }
}

let msgCounter = 0;
function env(p: Partial<Envelope> & { routingJid?: string }): Envelope {
  const routingJid = p.routingJid ?? "60111111111@s.whatsapp.net";
  return {
    waMessageId: `IN-${++msgCounter}`,
    routingJid,
    canonicalJid: routingJid,
    pushName: p.direction === "out" ? null : "Customer",
    body: "hello",
    type: "text",
    media: null,
    direction: "in",
    timestamp: new Date(),
    isHistory: false,
    ...p,
  };
}

// ─── Tiny runner ───

const results: Array<{ name: string; ok: boolean; err?: string }> = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, err: e instanceof Error ? e.message : String(e) });
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
}
const tick = (ms = 2) => new Promise((r) => setTimeout(r, ms));
async function settle(accountId?: string) {
  for (let i = 0; i < 15; i++) {
    if (accountId) await drain(accountId);
    await tick();
  }
}

const SECRET = "test-secret-123";
const auth = { Authorization: `Bearer ${SECRET}` };
const sessionsDir = mkdtempSync(join(tmpdir(), "wa-check-"));
const created: FakeSession[] = [];
const manager = new SessionManager({
  sessionsDir,
  createSession: (id, dir) => {
    const s = new FakeSession(id, dir);
    created.push(s);
    return s;
  },
});
const app = createApp({ manager, secret: SECRET });
const latest = (id: string) => [...created].reverse().find((s) => s.accountId === id)!;
const rows = (t: string, f: (r: Row) => boolean = () => true) => db[t]!.filter(f);
const convOf = (accountId: string, jid: string) => {
  const c = rows("wa_contacts", (r) => r.account_id === accountId && r.jid === jid)[0];
  return c ? rows("wa_conversations", (r) => r.contact_id === c.id)[0] : undefined;
};

await ensureMediaBucket();

// ─── Auth + health ───

await test("GET /health is public and lists accounts", async () => {
  const r = await app.request("/health");
  eq(r.status, 200, "status");
  const body = (await r.json()) as { ok: boolean; accounts: unknown[] };
  assert(body.ok === true && Array.isArray(body.accounts), "shape");
});
await test("missing bearer → 401", async () => {
  eq((await app.request("/pairings", { method: "POST" })).status, 401, "status");
});
await test("wrong bearer → 401", async () => {
  eq((await app.request("/pairings/x", { headers: { Authorization: "Bearer nope" } })).status, 401, "status");
});
await test("createApp refuses an empty secret", async () => {
  let threw = false;
  try {
    createApp({ manager, secret: "" });
  } catch {
    threw = true;
  }
  assert(threw, "should throw");
});

// ─── Pairing ───

let accountId = "";
let shopId = "";
await test("pairing: QR → connect creates shops row THEN wa_accounts row, exactly once across reconnects", async () => {
  const r = await app.request("/pairings", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ label: "My Shop WA" }) });
  eq(r.status, 200, "POST status");
  accountId = ((await r.json()) as { pairing_id: string }).pairing_id;
  const s = latest(accountId);
  eq(s.started, 1, "session started");

  s.setStatus("qr");
  s.emit("qr", "2@fake-qr-payload");
  await settle();
  const q = (await (await app.request(`/pairings/${accountId}`, { headers: auth })).json()) as { state: string; qr_data_url?: string };
  eq(q.state, "qr", "state");
  assert(q.qr_data_url?.startsWith("data:image/png;base64,"), "qr_data_url is a PNG data URL");

  // History arrives immediately on connect, before the account rows exist — must wait, not FK-fail.
  s.connect("60123456789");
  s.emit("history", [env({ routingJid: "60199999999@s.whatsapp.net", timestamp: new Date(Date.now() - 3600_000), isHistory: true })]);
  await settle(accountId);
  const done = (await (await app.request(`/pairings/${accountId}`, { headers: auth })).json()) as { state: string; shop_id?: string };
  eq(done.state, "connected", "state");
  const shops = rows("shops", (x) => x.external_id === accountId);
  eq(shops.length, 1, "one shops row");
  eq(shops[0]!.platform, "whatsapp", "platform");
  eq(shops[0]!.shop_name, "My Shop WA", "shop_name = label");
  shopId = shops[0]!.id as string;
  eq(done.shop_id, shopId, "pairing shop_id");
  const accts = rows("wa_accounts", (x) => x.id === accountId);
  eq(accts.length, 1, "one wa_accounts row");
  eq(accts[0]!.shop_id, shopId, "wa_accounts.shop_id");
  eq(accts[0]!.status, "connected", "status");
  eq(accts[0]!.phone_number, "60123456789", "phone");
  const order = insertOrder.filter((t) => t === "shops" || t === "wa_accounts");
  eq(order.join(">"), "shops>wa_accounts", "insert order");
  eq(rows("wa_messages", (x) => x.account_id === accountId).length, 1, "history that arrived during pairing was kept");

  // Later reconnects of the same session: status only, no second insert.
  const postsBefore = requests.filter((q) => q.method === "POST" && (q.table === "shops" || q.table === "wa_accounts")).length;
  s.setStatus("disconnected");
  await settle(accountId);
  eq(rows("wa_accounts", (x) => x.id === accountId)[0]!.status, "disconnected", "disconnect written");
  s.setStatus("connecting");
  s.connect("60123456789");
  await settle(accountId);
  const postsAfter = requests.filter((q) => q.method === "POST" && (q.table === "shops" || q.table === "wa_accounts")).length;
  eq(postsAfter, postsBefore, "no insert on reconnect");
  eq(rows("shops", (x) => x.external_id === accountId).length, 1, "still one shops row");
  eq(rows("wa_accounts", (x) => x.id === accountId)[0]!.status, "connected", "status back to connected");
  eq(((await (await app.request(`/pairings/${accountId}`, { headers: auth })).json()) as { state: string }).state, "connected", "pairing still connected");
});

await test("pairing: shop_name falls back to the phone number without a label", async () => {
  const r = await app.request("/pairings", { method: "POST", headers: auth });
  const id = ((await r.json()) as { pairing_id: string }).pairing_id;
  latest(id).connect("60155555555");
  await settle(id);
  eq(rows("shops", (x) => x.external_id === id)[0]?.shop_name, "60155555555", "shop_name");
});

await test("DELETE /pairings/:id cancels, stops the session and removes its folder; then 404", async () => {
  const id = ((await (await app.request("/pairings", { method: "POST", headers: auth })).json()) as { pairing_id: string }).pairing_id;
  mkdirSync(join(sessionsDir, id), { recursive: true });
  const r = await app.request(`/pairings/${id}`, { method: "DELETE", headers: auth });
  eq(r.status, 200, "status");
  assert(((await r.json()) as { ok: boolean }).ok, "ok");
  assert(latest(id).stopped, "session stopped");
  assert(!existsSync(join(sessionsDir, id)), "folder removed");
  eq((await app.request(`/pairings/${id}`, { headers: auth })).status, 404, "then 404");
});

await test("pairing that never connects expires and cleans up", async () => {
  const quick = new SessionManager({ sessionsDir, pairingTtlMs: 30, createSession: (i, d) => new FakeSession(i, d) });
  const id = await quick.startPairing();
  mkdirSync(join(sessionsDir, id), { recursive: true });
  await tick(80);
  eq(quick.getPairing(id), null, "expired → unknown");
  assert(!existsSync(join(sessionsDir, id)), "folder removed");
});

await test("unknown pairing → 404", async () => {
  eq((await app.request(`/pairings/${crypto.randomUUID()}`, { headers: auth })).status, 404, "status");
});

// ─── Inbound persistence ───

const A = () => latest(accountId);

await test("inbound creates contact + conversation + message, unread 1", async () => {
  const e = env({ routingJid: "60111111111@s.whatsapp.net", body: "hi there", timestamp: new Date() });
  A().emit("message", e);
  await settle(accountId);
  const contacts = rows("wa_contacts", (r) => r.account_id === accountId && r.jid === e.routingJid);
  eq(contacts.length, 1, "contact");
  eq(contacts[0]!.routing_jid, e.routingJid, "routing_jid");
  eq(contacts[0]!.phone_number, "60111111111", "phone");
  eq(contacts[0]!.name, "Customer", "name");
  const conv = convOf(accountId, e.routingJid)!;
  eq(conv.unread_count, 1, "unread");
  eq(conv.last_message_preview, "hi there", "preview");
  const msg = rows("wa_messages", (r) => r.wa_message_id === e.waMessageId);
  eq(msg.length, 1, "message");
  eq(msg[0]!.direction, "in", "direction");
  eq(msg[0]!.status, null, "status null for in");
});

await test("duplicate wa_message_id is ignored and doesn't bump unread", async () => {
  const e = env({ routingJid: "60111111111@s.whatsapp.net" });
  A().emit("message", e);
  A().emit("message", { ...e });
  A().emit("message", { ...e });
  await settle(accountId);
  eq(rows("wa_messages", (r) => r.wa_message_id === e.waMessageId).length, 1, "one row");
  eq(convOf(accountId, e.routingJid)!.unread_count, 2, "unread bumped once (1 → 2)");
});

await test('"@lid" inbound then phone-jid inbound → one contact, routing_jid = latest inbound jid', async () => {
  const phone = "60122222222@s.whatsapp.net";
  A().emit("message", env({ routingJid: "88888888888@lid", canonicalJid: phone }));
  await settle(accountId);
  let c = rows("wa_contacts", (r) => r.account_id === accountId && r.jid === phone);
  eq(c.length, 1, "keyed by phone");
  eq(c[0]!.routing_jid, "88888888888@lid", "routes to lid");
  A().emit("message", env({ routingJid: phone }));
  await settle(accountId);
  c = rows("wa_contacts", (r) => r.account_id === accountId && (r.jid === phone || r.jid === "88888888888@lid"));
  eq(c.length, 1, "still one contact");
  eq(c[0]!.routing_jid, phone, "routing_jid follows latest inbound");
  eq(convOf(accountId, phone)!.unread_count, 2, "one conversation, 2 unread");
});

await test('"@lid" contact learned before its phone is re-keyed, not duplicated', async () => {
  const lid = "77777777777@lid";
  const phone = "60133333333@s.whatsapp.net";
  A().emit("message", env({ routingJid: lid })); // no senderPn yet
  await settle(accountId);
  A().emit("message", env({ routingJid: lid, canonicalJid: phone }));
  await settle(accountId);
  const c = rows("wa_contacts", (r) => r.account_id === accountId && (r.jid === phone || r.jid === lid));
  eq(c.length, 1, "one contact");
  eq(c[0]!.jid, phone, "re-keyed to phone");
  eq(convOf(accountId, phone)!.unread_count, 2, "same conversation");
});

await test("history doesn't bump unread or move last_message_at backwards", async () => {
  const jid = "60111111111@s.whatsapp.net";
  const before = { ...convOf(accountId, jid)! };
  A().emit("history", [
    env({ routingJid: jid, timestamp: new Date(Date.now() - 86_400_000), isHistory: true, body: "old one" }),
    env({ routingJid: jid, timestamp: new Date(Date.now() - 2 * 86_400_000), isHistory: true, direction: "out", pushName: null }),
  ]);
  await settle(accountId);
  const after = convOf(accountId, jid)!;
  eq(after.unread_count, before.unread_count, "unread unchanged");
  eq(after.last_message_at, before.last_message_at, "last_message_at unchanged");
  eq(after.last_message_preview, before.last_message_preview, "preview unchanged");
  eq(rows("wa_messages", (r) => r.body === "old one").length, 1, "history row stored");
});

await test("history batch of 1,200 messages over 60 days: all stored, no unread, bulk requests", async () => {
  const day = 86_400_000;
  const batch: Envelope[] = [];
  for (let i = 0; i < 1200; i++) {
    const n = i % 40; // 40 customers
    batch.push(
      env({
        waMessageId: `HIST-${i}`,
        routingJid: `6019000${String(n).padStart(4, "0")}@s.whatsapp.net`,
        timestamp: new Date(Date.now() - 60 * day + i * (60 * day / 1200)),
        direction: i % 3 === 0 ? "out" : "in",
        pushName: i % 3 === 0 ? null : `C${n}`,
        isHistory: true,
      }),
    );
  }
  const msgsBefore = rows("wa_messages").length;
  const reqBefore = requests.length;
  A().emit("history", batch);
  await settle(accountId);
  const used = requests.length - reqBefore;
  eq(rows("wa_messages").length - msgsBefore, 1200, "all 1,200 stored (no cutoff/cap)");
  assert(rows("wa_messages", (r) => r.wa_message_id === "HIST-0").length === 1, "the 60-day-old one is kept");
  const convs = Array.from({ length: 40 }, (_, n) => convOf(accountId, `6019000${String(n).padStart(4, "0")}@s.whatsapp.net`)!);
  assert(convs.every((c) => c && c.unread_count === 0), "no unread on any history conversation");
  const newest = batch.filter((e) => e.routingJid === "60190000039@s.whatsapp.net").at(-1)!;
  eq(convs[39]!.last_message_at, newest.timestamp.toISOString(), "last_message_at = newest in batch");
  assert(used <= 60, `bounded requests: used ${used} for 1,200 messages`);
  console.log(`  (history: 1,200 messages / 40 conversations in ${used} fake-DB requests)`);

  // Re-delivering the same batch is a no-op.
  A().emit("history", batch);
  await settle(accountId);
  eq(rows("wa_messages").length - msgsBefore, 1200, "redelivered batch deduped");
});

await test("fromMe message from the phone persists as 'out' without unread", async () => {
  const jid = "60111111111@s.whatsapp.net";
  const before = convOf(accountId, jid)!.unread_count;
  const e = env({ routingJid: jid, direction: "out", pushName: null, body: "sent from phone" });
  A().emit("message", e);
  await settle(accountId);
  const m = rows("wa_messages", (r) => r.wa_message_id === e.waMessageId)[0]!;
  eq(m.direction, "out", "direction");
  eq(m.status, "sent", "status");
  eq(convOf(accountId, jid)!.unread_count, before, "unread unchanged");
  eq(convOf(accountId, jid)!.last_message_preview, "sent from phone", "preview updated");
});

// ─── Receipts ───

await test("receipts update 'out' status and never downgrade", async () => {
  const e = env({ routingJid: "60111111111@s.whatsapp.net", direction: "out", pushName: null });
  A().emit("message", e);
  await settle(accountId);
  const row = () => rows("wa_messages", (r) => r.wa_message_id === e.waMessageId)[0]!;
  A().emit("receipt", { waMessageId: e.waMessageId, status: "delivered" });
  await settle(accountId);
  eq(row().status, "delivered", "delivered");
  A().emit("receipt", { waMessageId: e.waMessageId, status: "sent" });
  await settle(accountId);
  eq(row().status, "delivered", "no downgrade");
  A().emit("receipt", { waMessageId: e.waMessageId, status: "read" });
  await settle(accountId);
  eq(row().status, "read", "read");
  const inbound = rows("wa_messages", (r) => r.direction === "in")[0]!;
  A().emit("receipt", { waMessageId: inbound.wa_message_id as string, status: "read" });
  await settle(accountId);
  eq(inbound.status, null, "inbound rows untouched");
});

// ─── Send ───

await test("POST /send sends via socket, persists 'out', returns message_id", async () => {
  const jid = "60111111111@s.whatsapp.net";
  const r = await app.request(`/accounts/${accountId}/send`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ jid, text: "Your order has shipped" }),
  });
  eq(r.status, 200, "status");
  const { message_id } = (await r.json()) as { message_id: string };
  const m = rows("wa_messages", (x) => x.id === message_id)[0];
  assert(m, "row exists");
  eq(m.direction, "out", "direction");
  eq(m.status, "sent", "status");
  eq(m.body, "Your order has shipped", "body");
  eq(A().sent.at(-1)?.jid, jid, "sent on socket");
  eq(convOf(accountId, jid)!.last_message_preview, "Your order has shipped", "conversation updated");
});

await test('POST /send to an "@lid" routing jid lands in the merged contact', async () => {
  const r = await app.request(`/accounts/${accountId}/send`, {
    method: "POST",
    headers: auth,
    // 60133333333's latest inbound came from this lid, so it's that contact's routing_jid.
    body: JSON.stringify({ jid: "77777777777@lid", text: "reply via lid" }),
  });
  eq(r.status, 200, "status");
  const { message_id } = (await r.json()) as { message_id: string };
  eq(rows("wa_contacts", (x) => x.account_id === accountId && x.jid === "77777777777@lid").length, 0, "no separate lid contact");
  const conv = convOf(accountId, "60133333333@s.whatsapp.net")!;
  eq(rows("wa_messages", (x) => x.id === message_id)[0]?.conversation_id, conv.id, "in the merged conversation");
  eq(rows("wa_contacts", (x) => x.jid === "60133333333@s.whatsapp.net")[0]!.routing_jid, "77777777777@lid", "outbound doesn't change routing");
});

await test("POST /send with Baileys' own echo racing the persist → one row, same id", async () => {
  A().echo = true;
  const r = await app.request(`/accounts/${accountId}/send`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ jid: "60111111111@s.whatsapp.net", text: "echo test" }),
  });
  A().echo = false;
  eq(r.status, 200, "status");
  const { message_id } = (await r.json()) as { message_id: string };
  const matches = rows("wa_messages", (x) => x.body === "echo test");
  eq(matches.length, 1, "one row");
  eq(matches[0]!.id, message_id, "returned id is that row");
});

await test("send to a disconnected account → 409", async () => {
  A().setStatus("disconnected");
  await settle(accountId);
  const r = await app.request(`/accounts/${accountId}/send`, { method: "POST", headers: auth, body: JSON.stringify({ jid: "60111111111@s.whatsapp.net", text: "x" }) });
  eq(r.status, 409, "status");
  A().connect("60123456789");
  await settle(accountId);
});

await test("send to an account in the DB with no live session → 409", async () => {
  const shop = { id: crypto.randomUUID(), platform: "whatsapp", external_id: "offline" };
  db.shops!.push(shop);
  const id = crypto.randomUUID();
  db.wa_accounts!.push({ id, shop_id: shop.id, status: "disconnected" });
  const r = await app.request(`/accounts/${id}/send`, { method: "POST", headers: auth, body: JSON.stringify({ jid: "60111111111@s.whatsapp.net", text: "x" }) });
  eq(r.status, 409, "status");
});

await test("send to an unknown account → 404", async () => {
  const body = JSON.stringify({ jid: "60111111111@s.whatsapp.net", text: "x" });
  eq((await app.request(`/accounts/${crypto.randomUUID()}/send`, { method: "POST", headers: auth, body })).status, 404, "uuid");
  eq((await app.request(`/accounts/not-a-uuid/send`, { method: "POST", headers: auth, body })).status, 404, "garbage id");
});

await test("send with a group jid or empty text → 400", async () => {
  const bad = [{ jid: "123-456@g.us", text: "x" }, { jid: "60111111111@s.whatsapp.net", text: "  " }];
  for (const b of bad) {
    eq((await app.request(`/accounts/${accountId}/send`, { method: "POST", headers: auth, body: JSON.stringify(b) })).status, 400, JSON.stringify(b));
  }
});

// ─── Media ───

const media = (mime: string, size: number | null, filename: string | null = null) => ({ mime, filename, size });

await test("live image → uploaded to MEDIA_BUCKET at mediaObjectPath, media_path set", async () => {
  const e = env({ type: "image", body: "look", media: media("image/jpeg", 1234), download: async () => Buffer.alloc(1234, 1) });
  A().emit("message", e);
  await settle(accountId);
  const m = rows("wa_messages", (r) => r.wa_message_id === e.waMessageId)[0]!;
  const path = mediaObjectPath({ accountId, conversationId: m.conversation_id as string, waMessageId: e.waMessageId, ext: "jpg" });
  eq(m.media_path, path, "media_path");
  eq(m.media_mime, "image/jpeg", "media_mime");
  eq(m.body, "look", "caption kept as body");
  const obj = storage.objects.get(`${MEDIA_BUCKET}/${path}`);
  assert(obj, "object uploaded");
  eq(obj.bytes, 1234, "bytes");
  eq(obj.contentType, "image/jpeg", "content type");
});

await test("live document keeps its file name; voice note uploads as .ogg", async () => {
  const d = env({ type: "document", body: null, media: media("application/pdf", 10, "invoice.pdf"), download: async () => Buffer.alloc(10) });
  const v = env({ type: "audio", body: null, media: media("audio/ogg; codecs=opus", 10), download: async () => Buffer.alloc(10) });
  A().emit("message", d);
  A().emit("message", v);
  await settle(accountId);
  const dm = rows("wa_messages", (r) => r.wa_message_id === d.waMessageId)[0]!;
  eq(dm.media_filename, "invoice.pdf", "filename");
  assert(String(dm.media_path).endsWith(".pdf"), "pdf path");
  const vm = rows("wa_messages", (r) => r.wa_message_id === v.waMessageId)[0]!;
  assert(String(vm.media_path).endsWith(".ogg"), `ogg path, got ${String(vm.media_path)}`);
});

await test("oversized media → not downloaded, message kept with media_path null", async () => {
  let called = false;
  const e = env({ type: "video", body: null, media: media("video/mp4", MEDIA_MAX_BYTES + 1), download: async () => ((called = true), Buffer.alloc(1)) });
  const objects = storage.objects.size;
  A().emit("message", e);
  await settle(accountId);
  const m = rows("wa_messages", (r) => r.wa_message_id === e.waMessageId)[0];
  assert(m, "message kept");
  eq(m.media_path, null, "media_path null");
  eq(m.type, "video", "type recorded");
  assert(!called, "download not attempted");
  eq(storage.objects.size, objects, "nothing uploaded");
});

await test("download throws → message kept, media_path null", async () => {
  const e = env({ type: "image", body: null, media: media("image/jpeg", 100), download: async () => { throw new Error("media expired"); } });
  A().emit("message", e);
  await settle(accountId);
  const m = rows("wa_messages", (r) => r.wa_message_id === e.waMessageId)[0];
  assert(m, "message kept");
  eq(m.media_path, null, "media_path null");
});

await test("history media → not downloaded; mime/filename still recorded", async () => {
  const objects = storage.objects.size;
  const e = env({ type: "document", body: null, media: media("application/pdf", 50, "old.pdf"), isHistory: true, timestamp: new Date(Date.now() - 5 * 86_400_000) });
  A().emit("history", [e]);
  await settle(accountId);
  const m = rows("wa_messages", (r) => r.wa_message_id === e.waMessageId)[0]!;
  eq(m.media_path, null, "no path");
  eq(m.media_mime, "application/pdf", "mime");
  eq(m.media_filename, "old.pdf", "filename");
  eq(storage.objects.size, objects, "nothing uploaded");
});

await test("ensureMediaBucket is idempotent", async () => {
  await ensureMediaBucket();
  assert(storage.buckets.has(MEDIA_BUCKET), "bucket exists");
});

// ─── Logged out / resume / watchdog ───

await test("logged out on the phone → status logged_out, rows kept, folder removed, no reconnect", async () => {
  const r = await app.request("/pairings", { method: "POST", headers: auth });
  const id = ((await r.json()) as { pairing_id: string }).pairing_id;
  const s = latest(id);
  s.connect("60166666666");
  await settle(id);
  s.emit("message", env({ routingJid: "60177777777@s.whatsapp.net" }));
  await settle(id);
  mkdirSync(join(sessionsDir, id), { recursive: true });
  s.status = "logged_out";
  s.emit("loggedOut");
  await settle(id);
  eq(rows("wa_accounts", (x) => x.id === id)[0]!.status, "logged_out", "status");
  eq(rows("shops", (x) => x.external_id === id).length, 1, "shops row kept");
  eq(rows("wa_messages", (x) => x.account_id === id).length, 1, "messages kept");
  assert(!existsSync(join(sessionsDir, id)), "folder removed");
  assert(s.stopped, "stopped");
  const h = (await (await app.request("/health")).json()) as { accounts: Array<{ id: string; status: string }> };
  eq(h.accounts.find((a) => a.id === id)?.status, "logged_out", "health shows logged_out");
});

// Accounts seeded directly in the DB for the resume tests.
function seedAccount(status: string, withCreds: boolean): string {
  const shop = { id: crypto.randomUUID(), platform: "whatsapp", external_id: crypto.randomUUID() };
  db.shops!.push(shop);
  const id = shop.external_id;
  db.wa_accounts!.push({ id, shop_id: shop.id, status });
  if (withCreds) {
    mkdirSync(join(sessionsDir, id), { recursive: true });
    writeFileSync(join(sessionsDir, id, "creds.json"), "{}");
  }
  return id;
}

await test("boot: resume every non-logged-out account; missing creds → logged_out", async () => {
  // Fresh manager = fresh process. Seed after clearing earlier accounts' statuses.
  for (const a of db.wa_accounts!) a.status = "logged_out";
  const good = seedAccount("disconnected", true);
  const noCreds = seedAccount("connected", false);
  const skipped = seedAccount("logged_out", true);
  const made: FakeSession[] = [];
  const boot = new SessionManager({ sessionsDir, createSession: (i, d) => (made.push(new FakeSession(i, d)), made.at(-1)!) });
  await boot.resumeAll();
  await settle(noCreds);
  eq(made.length, 1, "one session created");
  eq(made[0]!.accountId, good, "the account with creds");
  eq(made[0]!.started, 1, "started");
  eq(rows("wa_accounts", (x) => x.id === noCreds)[0]!.status, "logged_out", "no creds → logged_out");
  assert(!made.some((s) => s.accountId === skipped), "logged_out not resumed");

  made[0]!.connect("60100000000");
  await settle(good);
  eq(rows("wa_accounts", (x) => x.id === good)[0]!.status, "connected", "status written");
  assert(rows("wa_accounts", (x) => x.id === good)[0]!.last_seen_at, "last_seen_at set");

  // A resumed session asking for a QR = creds expired → logged out (nobody can scan it).
  made[0]!.setStatus("qr");
  made[0]!.emit("qr", "2@x");
  await settle(good);
  eq(rows("wa_accounts", (x) => x.id === good)[0]!.status, "logged_out", "qr on resume → logged_out");
  assert(made[0]!.stopped, "stopped");
  eq(made.length, 1, "not restarted");
});

await test("watchdog replaces only silently-dead sessions; skips connecting ones and pending backoffs", async () => {
  const dead = seedAccount("connected", true);
  const connecting = seedAccount("connecting", true);
  const backing = seedAccount("disconnected", true);
  const made: FakeSession[] = [];
  const m = new SessionManager({ sessionsDir, createSession: (i, d) => (made.push(new FakeSession(i, d)), made.at(-1)!) });
  for (const a of db.wa_accounts!) if (![dead, connecting, backing].includes(a.id as string)) a.status = "logged_out";
  await m.resumeAll();
  const byId = (id: string) => made.filter((s) => s.accountId === id);
  byId(dead)[0]!.connect(null);
  byId(dead)[0]!.alive = false; // socket gone, no close event
  byId(backing)[0]!.connect(null);
  byId(backing)[0]!.setStatus("disconnected");
  byId(backing)[0]!.pending = true; // its own backoff is scheduled
  await settle();
  await Promise.all([m.watchdog(), m.watchdog()]); // overlapping runs must not double-reconnect
  eq(byId(dead).length, 2, "dead session replaced exactly once");
  assert(byId(dead)[0]!.stopped, "old one stopped");
  eq(byId(dead)[1]!.started, 1, "new one started");
  eq(byId(connecting).length, 1, "connecting session left alone");
  eq(byId(backing).length, 1, "pending backoff left alone");
  // The replaced session's late events must not write anything.
  byId(dead)[0]!.emit("status", "disconnected");
  await settle(dead);
  eq(rows("wa_accounts", (x) => x.id === dead)[0]!.status, "connected", "stale session ignored");
});

// ─── Parsing (Baileys shapes) ───

await test("parse: 1:1 only, @lid canonical via senderPn, captions, types, receipt codes", async () => {
  const base = { messageTimestamp: 1_700_000_000 };
  const msg = (key: object, message: object, extra: object = {}) => ({ key, message, ...base, ...extra }) as unknown as WAMessage;
  eq(toEnvelope(msg({ remoteJid: "123-456@g.us", id: "a" }, { conversation: "x" }), false), null, "group skipped");
  eq(toEnvelope(msg({ remoteJid: "status@broadcast", id: "b" }, { conversation: "x" }), false), null, "status skipped");
  eq(toEnvelope(msg({ remoteJid: "1@newsletter", id: "c" }, { conversation: "x" }), false), null, "newsletter skipped");
  eq(toEnvelope(msg({ remoteJid: "601@s.whatsapp.net", id: "d" }, { reactionMessage: { text: "👍" } }), false), null, "reaction skipped");
  const lid = toEnvelope(msg({ remoteJid: "999@lid", id: "e", senderPn: "60123@s.whatsapp.net" }, { conversation: "yo" }, { pushName: "Ann" }), false)!;
  eq(lid.canonicalJid, "60123@s.whatsapp.net", "canonical");
  eq(lid.routingJid, "999@lid", "routing");
  eq(lid.pushName, "Ann", "push name");
  const img = toEnvelope(msg({ remoteJid: "601@s.whatsapp.net", id: "f" }, { ephemeralMessage: { message: { imageMessage: { caption: "pic", mimetype: "image/jpeg", fileLength: 42 } } } }), false)!;
  eq(img.type, "image", "ephemeral image unwrapped");
  eq(img.body, "pic", "caption");
  eq(img.media?.size, 42, "size");
  const mine = toEnvelope(msg({ remoteJid: "601@s.whatsapp.net", id: "g", fromMe: true }, { conversation: "me" }, { pushName: "Owner" }), false)!;
  eq(mine.direction, "out", "fromMe → out");
  eq(mine.pushName, null, "own push name not used");
  eq(toEnvelope(msg({ remoteJid: "601@s.whatsapp.net", id: "h" }, { locationMessage: {} }), false)?.type, "other", "location → other");
  eq([0, 1, 2, 3, 4, 5].map(receiptStatus).join(","), "failed,,sent,delivered,read,read", "receipt codes");
});

// ─── Summary ───

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.err ? `\n      ${r.err}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
