/**
 * Offline end-to-end check of the dashboard API (server/app.ts): every route runs for real, with
 * globalThis.fetch intercepted — an in-memory fake of Supabase (PostgREST + Storage), canned
 * Shopee Open Platform responses, and a fake WhatsApp worker. No network, no accounts.
 *   Run: npm run check        (the worker has its own: cd worker && npm run check)
 *   Serve the fixtures to click through the UI: tsx scripts/check-api.ts --serve  (API on :8787; then `vite`)
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";

const PARTNER_KEY = "test-partner-key";
Object.assign(process.env, {
  SHOPEE_PARTNER_ID: "1234187",
  SHOPEE_PARTNER_KEY: PARTNER_KEY,
  SHOPEE_ENV: "live",
  SHOPEE_REDIRECT_URL: "https://example.vercel.app/api/shopee/callback",
  SUPABASE_URL: "https://fake.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role",
  TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
  WA_WORKER_URL: "https://wa-worker.test/",
  WA_WORKER_SECRET: "worker-secret",
  APP_PASSWORD: "",
  MOCK_CHAT: "",
});

// Env first: config modules read it at import time.
const { encrypt, decrypt } = await import("../lib/crypto.js");

// ─── Fake Supabase: a small in-memory PostgREST ───

type Row = Record<string, any>;
const SHOPEE_SHOP = { id: "uuid-shopee", platform: "shopee", external_id: "111", shop_name: "Cadoopet", disconnected_at: null, connected_at: "2026-01-01" };
const WA_SHOP = { id: "uuid-wa", platform: "whatsapp", external_id: "acc-1", shop_name: "Cadoopet WhatsApp", disconnected_at: null, connected_at: "2026-01-02" };
const iso = (ms: number) => new Date(ms).toISOString();
const T0 = 1_790_000_000_000;
const tables: Record<string, Row[]> = {
  shops: [SHOPEE_SHOP, WA_SHOP],
  shop_tokens: [
    { shop_id: SHOPEE_SHOP.id, access_token_enc: encrypt("shopee-access"), refresh_token_enc: encrypt("shopee-refresh"), access_expires_at: iso(Date.now() + 3600e3) },
  ],
  wa_accounts: [{ id: "acc-1", shop_id: "uuid-wa", status: "connected" }, { id: "acc-2", shop_id: "uuid-other", status: "connected" }],
  wa_contacts: [
    { id: "c1", account_id: "acc-1", jid: "60123456789@s.whatsapp.net", routing_jid: "999888@lid", name: "Aisyah", saved_name: null, phone_number: "60123456789" },
    { id: "c2", account_id: "acc-1", jid: "60111@s.whatsapp.net", routing_jid: null, name: "zk_self", saved_name: "Zack Kho", phone_number: "60111" },
    { id: "c3", account_id: "acc-2", jid: "60999@s.whatsapp.net", routing_jid: null, name: "Other number's contact", saved_name: null, phone_number: "60999" },
    { id: "c4", account_id: "acc-1", jid: "255189911093281@lid", routing_jid: "255189911093281@lid", name: null, saved_name: null, phone_number: null },
    { id: "c5", account_id: "acc-1", jid: "60122@s.whatsapp.net", routing_jid: null, name: null, saved_name: null, phone_number: "60122" },
  ],
  wa_conversations: [
    { id: "v1", account_id: "acc-1", contact_id: "c1", last_message_at: iso(T0 + 60_000), last_message_preview: "ada stok?", unread_count: 2 },
    { id: "v2", account_id: "acc-1", contact_id: "c2", last_message_at: iso(T0), last_message_preview: "ok", unread_count: 0 },
    { id: "v3", account_id: "acc-2", contact_id: "c3", last_message_at: iso(T0 + 120_000), last_message_preview: "secret", unread_count: 5 },
    { id: "v4", account_id: "acc-1", contact_id: "c4", last_message_at: iso(T0 - 1000), last_message_preview: "hi", unread_count: 0 },
    { id: "v5", account_id: "acc-1", contact_id: "c5", last_message_at: iso(T0 - 2000), last_message_preview: "yo", unread_count: 0 },
  ],
  wa_messages: [
    { id: "m2", conversation_id: "v1", account_id: "acc-1", wa_message_id: "W2", direction: "in", type: "text", body: "ada stok?", media_path: null, media_mime: null, media_filename: null, status: null, created_at: iso(T0 + 60_000) },
    { id: "m1", conversation_id: "v1", account_id: "acc-1", wa_message_id: "W1", direction: "out", type: "text", body: "Hi! Cadoopet here", media_path: null, media_mime: null, media_filename: null, status: "read", created_at: iso(T0) },
    { id: "m3", conversation_id: "v1", account_id: "acc-1", wa_message_id: "W3", direction: "in", type: "image", body: null, media_path: null, media_mime: "image/jpeg", media_filename: null, status: null, created_at: iso(T0 + 61_000) },
    { id: "m4", conversation_id: "v1", account_id: "acc-1", wa_message_id: "W4", direction: "in", type: "document", body: "invoice pls", media_path: "whatsapp/acc-1/v1/W4.pdf", media_mime: "application/pdf", media_filename: "PO-1234.pdf", status: null, created_at: iso(T0 + 62_000) },
    { id: "m9", conversation_id: "v3", account_id: "acc-2", wa_message_id: "W9", direction: "in", type: "text", body: "other number", media_path: null, media_mime: null, media_filename: null, status: null, created_at: iso(T0) },
  ],
};
const dbWrites: Array<{ table: string; method: string; url: string; body: any }> = [];

function applyFilters(rows: Row[], params: URLSearchParams) {
  let out = rows;
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    const [op, ...rest] = v.split(".");
    const val = rest.join(".");
    if (op === "eq") out = out.filter((r) => String(r[k]) === val);
    else if (op === "gt") out = out.filter((r) => Number(r[k]) > Number(val));
    else if (op === "is" && val === "null") out = out.filter((r) => r[k] == null);
    else throw new Error(`fake db: unsupported filter ${k}=${v}`);
  }
  const order = params.get("order");
  if (order) {
    const [col, dir] = order.split(".");
    out = [...out].sort((a, b) => (a[col!] < b[col!] ? -1 : a[col!] > b[col!] ? 1 : 0) * (dir === "desc" ? -1 : 1));
  }
  const limit = params.get("limit");
  return limit ? out.slice(0, Number(limit)) : out;
}

/** Handles `alias:table(cols)` embeds by following <alias>_id → table.id. */
function project(row: Row, select: string | null) {
  if (!select || select === "*") return { ...row };
  const out: Row = {};
  for (const part of select.match(/[^,(]+\([^)]*\)|[^,]+/g) ?? []) {
    const embed = /^(\w+):(\w+)\(([^)]*)\)$/.exec(part.trim());
    if (embed) {
      const [, alias, table, cols] = embed;
      const target = tables[table!]!.find((t) => t.id === row[`${alias}_id`]);
      out[alias!] = target ? Object.fromEntries(cols!.split(",").map((c) => [c.trim(), target[c.trim()]])) : null;
    } else out[part.trim()] = row[part.trim()];
  }
  return out;
}

// ─── Fake Shopee Open Platform ───

const shopeeCalls: Array<{ path: string; params: URLSearchParams; body: any }> = [];
const workerCalls: Array<{ method: string; path: string; auth: string | null; body: any }> = [];
const signCalls: Array<{ bucket: string; paths: string[]; expiresIn: number }> = [];
let workerDown = false;

function shopee(path: string, params: URLSearchParams): unknown {
  switch (path) {
    case "/api/v2/product/get_item_list":
      return { response: { item: [{ item_id: 1 }, { item_id: 2 }], has_next_page: false, total_count: 2 } };
    case "/api/v2/product/get_item_base_info":
      return { response: { item_list: [
        { item_id: 1, item_name: "Cat food 1.5kg", item_sku: "CF1", item_status: "NORMAL", has_model: false, price_info: [{ current_price: 25.5, original_price: 30 }], stock_info_v2: { summary_info: { total_available_stock: 3, total_reserved_stock: 0 } } },
        { item_id: 2, item_name: "Dog bone", item_sku: "DB", item_status: "NORMAL", has_model: true, stock_info_v2: { summary_info: { total_available_stock: 40, total_reserved_stock: 0 } } },
      ] } };
    case "/api/v2/product/update_price":
      return { response: { success_list: [] } };
    case "/api/v2/order/get_order_list": {
      const page2 = params.get("cursor") === "page2";
      return { response: page2
        ? { order_list: [{ order_sn: `B-${params.get("time_from")}` }], more: false, next_cursor: "" }
        : { order_list: [{ order_sn: `A-${params.get("time_from")}` }], more: true, next_cursor: "page2" } };
    }
    case "/api/v2/order/get_order_detail": {
      const sns = params.get("order_sn_list")!.split(",");
      return { response: { order_list: sns.map((sn, i) => ({
        order_sn: sn, order_status: i === 0 ? "COMPLETED" : "CANCELLED", total_amount: 60, currency: "MYR",
        buyer_username: "aisyah", create_time: 1_790_000_000 + i, update_time: 1_790_000_100,
        item_list: [
          { item_id: 1, item_name: "Cat food 1.5kg", model_quantity_purchased: 2, model_original_price: 30, model_discounted_price: 25 },
          { item_id: 2, item_name: "Dog bone", model_quantity_purchased: 1, model_original_price: 10, model_discounted_price: 10 },
        ],
      })) } };
    }
    case "/api/v2/sellerchat/get_conversation_list":
      return { response: {
        conversations: [{ conversation_id: "conv1", to_id: 5555, to_name: "aisyah", unread_count: 2, latest_message_content: { text: "ada stok?" }, last_message_timestamp: 1_790_000_000_123_456_789 }],
        page_result: { more: false, next_cursor: { next_message_time_nano: "0", conversation_id: "" } },
      } };
    case "/api/v2/sellerchat/get_message":
      return { response: {
        messages: [
          { message_id: "sm1", from_id: 5555, to_id: 111, from_shop_id: 0, message_type: "text", content: { text: "ada stok?" }, created_timestamp: 1_790_000_000 },
          { message_id: "sm2", from_id: 111, to_id: 5555, from_shop_id: 111, message_type: "text", content: { text: "Ada!" }, created_timestamp: 1_790_000_060 },
        ],
        page_result: { next_offset: "", more: false },
      } };
    case "/api/v2/sellerchat/send_message":
      return { response: { message_id: "sm3" } };
    case "/api/v2/voucher/get_voucher_list":
      return { response: { voucher_list: [
        { voucher_id: 9, voucher_code: "MEOW10", voucher_name: "10% off", percentage: 10, discount_amount: 0, start_time: 1_790_000_000, end_time: 1_790_086_400 },
        { voucher_id: 10, voucher_code: "RM5", voucher_name: "RM5 off", percentage: 0, discount_amount: 5, start_time: 1_790_000_000, end_time: 1_790_086_400 },
      ], more: false } };
    case "/api/v2/ads/get_total_balance":
      return { response: {} }; // no report_list — the known-WIP endpoint
    case "/api/v2/auth/access_token/get":
      return { access_token: "shopee-access-2", refresh_token: "shopee-refresh-2", expire_in: 14400, error: "" };
    case "/api/v2/auth/token/get":
      return { access_token: "new-access", refresh_token: "new-refresh", expire_in: 14400, error: "" };
    case "/api/v2/shop/get_shop_info":
      return { shop_name: "Oreo Pet Shop", region: "MY", status: "NORMAL", error: "" };
  }
  throw new Error(`unexpected Shopee path ${path}`);
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const body = req.method === "GET" ? undefined : await req.text();

  if (url.host === "fake.supabase.co" && url.pathname.startsWith("/storage/v1/object/sign/")) {
    const bucket = url.pathname.split("/").pop()!;
    const { paths, expiresIn } = JSON.parse(body!);
    signCalls.push({ bucket, paths, expiresIn });
    return json(paths.map((path: string) => ({ path, signedURL: `/object/sign/${bucket}/${path}?token=t`, error: null })));
  }
  if (url.host === "fake.supabase.co") {
    const table = url.pathname.replace("/rest/v1/", "");
    const rows = tables[table] ?? (tables[table] = []);
    const wantsObject = (req.headers.get("accept") ?? "").includes("vnd.pgrst.object");
    if (req.method === "GET") {
      const hits = applyFilters(rows, url.searchParams).map((r) => project(r, url.searchParams.get("select")));
      if (wantsObject) return hits.length === 1 ? json(hits[0]) : json({ code: "PGRST116", message: "no rows" }, 406);
      return json(hits);
    }
    const parsed = body ? JSON.parse(body) : undefined;
    dbWrites.push({ table, method: req.method, url: url.search, body: parsed });
    if (req.method === "PATCH") {
      for (const r of applyFilters(rows, url.searchParams)) Object.assign(r, parsed);
      return new Response(null, { status: 204 });
    }
    if (req.method === "POST") {
      if (table === "shops") return json(wantsObject ? { id: "uuid-new" } : [{ id: "uuid-new" }], 201);
      if (table === "shop_tokens") {
        const i = rows.findIndex((r) => r.shop_id === parsed.shop_id);
        if (i >= 0) rows[i] = parsed;
        else rows.push(parsed);
      }
      return new Response(null, { status: 201 });
    }
  }
  if (url.host === "partner.shopeemobile.com") {
    const parsed = body ? JSON.parse(body) : undefined;
    shopeeCalls.push({ path: url.pathname, params: url.searchParams, body: parsed });
    return json(shopee(url.pathname, url.searchParams));
  }
  if (url.host === "wa-worker.test") {
    workerCalls.push({ method: req.method, path: url.pathname, auth: req.headers.get("authorization"), body: body ? JSON.parse(body) : undefined });
    if (workerDown) throw new TypeError("fetch failed");
    if (req.method === "POST" && url.pathname === "/pairings") return json({ pairing_id: "p1" });
    if (req.method === "GET" && url.pathname === "/pairings/p1") return json({ state: "qr", qr_data_url: "data:image/png;base64,AAA" });
    if (req.method === "GET" && url.pathname === "/pairings/gone") return json({ error: "unknown pairing" }, 404);
    if (req.method === "DELETE" && url.pathname === "/pairings/p1") return json({ ok: true });
    if (req.method === "POST" && url.pathname === "/accounts/acc-1/send") return json({ message_id: "m-new" });
    return json({ error: "not found" }, 404);
  }
  throw new Error(`unexpected fetch ${req.method} ${req.url}`);
}) as typeof fetch;

const { app } = await import("../server/app.js");

if (process.argv.includes("--serve")) {
  const { serve } = await import("@hono/node-server");
  serve({ fetch: app.fetch, port: 8787 }, () => console.log("fixture API on http://localhost:8787 — run `vite` for the UI"));
  await new Promise(() => {});
}

// ─── Helpers ───

const call = async (path: string, init?: RequestInit) => {
  const res = await app.request(path, init);
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data, headers: res.headers };
};
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const calls = (path: string) => shopeeCalls.filter((c) => c.path === path);
const results: string[] = [];
const ok = (name: string) => results.push(`  ✓ ${name}`);

// ─── Platforms + shops ───

{
  const { data } = await call("/api/platforms");
  const sp = data.platforms.find((p: any) => p.id === "shopee");
  const w = data.platforms.find((p: any) => p.id === "whatsapp");
  assert.deepEqual(sp.capabilities, ["connect", "catalog", "orders", "chat", "promotions", "ads", "webhook"]);
  assert.equal(sp.connect_via, "oauth");
  assert.deepEqual(w.capabilities, ["pairing", "chat"]);
  assert.equal(w.connect_via, "pairing");
  assert.equal(w.connectable, true);
  ok("/platforms: Shopee oauth + 7 capabilities; WhatsApp pairing + chat, connectable with worker env set");
}
{
  const { data } = await call("/api/shops");
  assert.equal(data.shops.length, 2);
  assert.equal(data.shops[0].platform, "shopee");
  ok("/shops: lists both platforms' shops");
}

// ─── Shopee data ───

{
  const { data } = await call("/api/products");
  assert.equal(data.errors.length, 0, "WhatsApp has no catalog → skipped, not errored");
  assert.equal(data.items.length, 2);
  const [a, b] = data.items;
  assert.deepEqual({ ...a }, { id: "1", name: "Cat food 1.5kg", sku: "CF1", status: "NORMAL", has_variants: false, price: 25.5, stock: 3, shop_id: "uuid-shopee", shop_name: "Cadoopet" });
  assert.equal(b.has_variants, true);
  assert.equal(b.price, null);
  const p = calls("/api/v2/product/get_item_list")[0]!.params;
  const expected = crypto.createHmac("sha256", PARTNER_KEY).update(`1234187/api/v2/product/get_item_list${p.get("timestamp")}shopee-access111`).digest("hex");
  assert.equal(p.get("sign"), expected);
  assert.equal(p.get("shop_id"), "111");
  ok("/products: neutral Product, variant price null, WhatsApp skipped, shop signature matches Shopee's formula");
}
{
  const r = await post("/api/products", { shop_id: "uuid-shopee", product_id: "1", price: 27.9 });
  assert.equal(r.status, 200);
  assert.deepEqual(calls("/api/v2/product/update_price").at(-1)!.body, { item_id: 1, price_list: [{ original_price: 27.9 }] });
  assert.equal((await post("/api/products", { shop_id: "uuid-wa", product_id: "1", price: 5 })).status, 400);
  assert.equal((await post("/api/products", { shop_id: "uuid-shopee", product_id: "1", price: 0 })).status, 400);
  ok("POST /products: sends Shopee {item_id, price_list}; WhatsApp shop → 400; price 0 → 400");
}
{
  shopeeCalls.length = 0;
  const { data } = await call("/api/orders?days=20");
  const lists = calls("/api/v2/order/get_order_list");
  assert.equal(lists.length, 4, "20 days = 2 windows × 2 pages");
  const w1 = lists[0]!.params, w2 = lists[2]!.params;
  assert.equal(Number(w1.get("time_to")) - Number(w1.get("time_from")), 15 * 86400);
  assert.equal(w2.get("time_from"), w1.get("time_to"));
  assert.equal(data.items.length, 4);
  assert.ok(data.items[0].created_at > data.items.at(-1).created_at, "newest first");
  const o = data.items.find((x: any) => x.status === "COMPLETED");
  assert.equal(o.counts_as_sale, true);
  assert.equal(o.created_at % 1000, 0, "seconds → ms");
  assert.deepEqual(o.lines[0], { product_id: "1", name: "Cat food 1.5kg", qty: 2, unit_price: 25 });
  assert.equal(data.items.find((x: any) => x.status === "CANCELLED").counts_as_sale, false);
  ok("/orders: 20 days → 2×15-day windows, cursor followed, CANCELLED not a sale, ms timestamps, newest first");
}
{
  const { data } = await call("/api/insights");
  const cat = data.sales.find((r: any) => r.product_id === "1");
  assert.equal(cat.qty, 2);
  assert.equal(cat.revenue, 50);
  assert.equal(data.by_shop[0].orders, 1);
  assert.equal(data.by_shop[0].revenue, 60);
  assert.equal(data.sizes[0].bucket, "50-100");
  ok("/insights: only paid orders counted, revenue = unit_price × qty, per-shop totals, size buckets");
}
{
  const { computeBasket } = await import("../lib/analytics.js");
  const order = (ids: string[]) => ({ id: "x", status: "", counts_as_sale: true, total: 1, currency: "MYR", buyer_name: null, created_at: 0, lines: ids.map((product_id) => ({ product_id, name: "", qty: 1, unit_price: 1 })) });
  const pairs = computeBasket([...Array(6)].map(() => order(["10", "9"])).concat([order(["9"])]));
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]!.product_a, "9", "numeric order: 9 before 10");
  assert.equal(pairs[0]!.confidence, Math.round((6 / 7) * 1e6) / 1e6);
  ok("computeBasket: '9' sorts before '10' like numeric ids; confidence unchanged");
}
{
  const v = await call("/api/vouchers");
  assert.equal(v.data.items[0].percentage, 10);
  assert.equal(v.data.items[1].percentage, null);
  assert.equal(v.data.items[1].amount, 5);
  assert.equal(v.data.items[0].starts_at, 1_790_000_000_000);
  assert.deepEqual((await call("/api/ads")).data, { items: [], errors: [] });
  ok("/vouchers: % vs fixed-amount mapped; /ads: empty report handled (endpoint still WIP)");
}

// ─── Chat: Shopee + WhatsApp in one inbox ───

{
  const list = await call("/api/chat/conversations");
  assert.equal(list.data.errors.length, 0);
  const ids = list.data.items.map((c: any) => `${c.shop_id}:${c.id}`);
  for (const want of ["uuid-shopee:conv1", "uuid-wa:v1", "uuid-wa:v2", "uuid-wa:v4", "uuid-wa:v5"]) assert.ok(ids.includes(want), want);
  assert.ok(!ids.some((i: string) => i.endsWith(":v3")), "another number's chats never leak in");
  assert.equal(list.data.items.find((c: any) => c.id === "conv1").last_at, 1_790_000_000_123, "Shopee ns → ms");
  const wa = list.data.items.find((c: any) => c.id === "v1");
  assert.deepEqual(
    { peer_name: wa.peer_name, peer_id: wa.peer_id, unread: wa.unread, last_text: wa.last_text, last_at: wa.last_at, shop_name: wa.shop_name },
    { peer_name: "Aisyah", peer_id: "999888@lid", unread: 2, last_text: "ada stok?", last_at: T0 + 60_000, shop_name: "Cadoopet WhatsApp" },
  );
  const name = (id: string) => list.data.items.find((c: any) => c.id === id).peer_name;
  assert.equal(name("v2"), "Zack Kho", "address-book name wins over push name");
  assert.equal(name("v5"), "+60122", "no names → phone");
  assert.equal(name("v4"), "WhatsApp user (number hidden)", "@lid only, no name → says the number is hidden");
  assert.deepEqual((await call("/api/chat/conversations?type=unread&shop=uuid-wa")).data.items.map((c: any) => c.id), ["v1"]);
  ok("/chat/conversations: Shopee + WhatsApp merged; names: address book → push name → phone → 'number hidden'; unread filter; other numbers excluded");
}
{
  const thread = await call("/api/chat/messages?shop_id=uuid-wa&conversation_id=v1");
  assert.deepEqual(thread.data.messages.map((m: any) => [m.id, m.from, m.type, m.text]), [
    ["m1", "shop", "text", "Hi! Cadoopet here"],
    ["m2", "customer", "text", "ada stok?"],
    ["m3", "customer", "image", null],
    ["m4", "customer", "document", "invoice pls"],
  ]);
  const [m3, m4] = [thread.data.messages[2], thread.data.messages[3]];
  assert.equal(m3.url, null, "history media (no file) → no url");
  assert.match(m4.url, /^https:\/\/fake\.supabase\.co\/storage\/v1\/object\/sign\/media\/whatsapp\/acc-1\/v1\/W4\.pdf\?token=t/);
  assert.equal(m4.filename, "PO-1234.pdf");
  assert.deepEqual(signCalls.at(-1), { bucket: "media", paths: ["whatsapp/acc-1/v1/W4.pdf"], expiresIn: 6 * 3600 });
  assert.equal(tables.wa_conversations!.find((c) => c.id === "v1")!.unread_count, 0, "opening a thread marks it read");
  const foreign = await call("/api/chat/messages?shop_id=uuid-wa&conversation_id=v3");
  assert.deepEqual(foreign.data.messages, [], "a conversation id from another number returns nothing");
  assert.equal(tables.wa_conversations!.find((c) => c.id === "v3")!.unread_count, 5, "…and isn't marked read");
  ok("/chat/messages (WhatsApp): oldest first, direction/type mapped, media signed in one call (6h), marks read; scoped to the number");
}
{
  const sent = await post("/api/chat/send", { shop_id: "uuid-wa", conversation_id: "v1", peer_id: "tampered@s.whatsapp.net", text: "  Ada stok ya!  " });
  assert.equal(sent.status, 200);
  const w = workerCalls.at(-1)!;
  assert.deepEqual([w.method, w.path, w.auth, w.body], ["POST", "/accounts/acc-1/send", "Bearer worker-secret", { jid: "999888@lid", text: "Ada stok ya!" }]);
  const cross = await post("/api/chat/send", { shop_id: "uuid-wa", conversation_id: "v3", peer_id: "x", text: "hi" });
  assert.equal(cross.status, 500);
  assert.match(cross.data.error, /not found on this number/);
  workerDown = true;
  const down = await post("/api/chat/send", { shop_id: "uuid-wa", conversation_id: "v1", peer_id: "x", text: "hi" });
  workerDown = false;
  assert.match(down.data.error, /worker unreachable/);
  assert.equal((await call("/api/chat/conversations?shop=uuid-wa")).data.items.length, 4, "reading works while the worker is down");
  ok("/chat/send (WhatsApp): goes to the stored routing jid (client peer_id ignored), bearer sent; other number's convo refused; clear worker-down error");
}
{
  const spSent = await post("/api/chat/send", { shop_id: "uuid-shopee", conversation_id: "conv1", peer_id: "5555", text: "Ada!" });
  assert.equal(spSent.status, 200);
  assert.deepEqual(calls("/api/v2/sellerchat/send_message").at(-1)!.body, { to_id: 5555, message_type: "text", content: { text: "Ada!" } });
  ok("/chat/send (Shopee): {to_id:number}");
}

// ─── WhatsApp pairing ───

{
  const start = await post("/api/whatsapp/pairings", { label: "  Cadoopet Sales " });
  assert.deepEqual(start.data, { pairing_id: "p1" });
  assert.deepEqual(workerCalls.at(-1)!.body, { label: "Cadoopet Sales" });
  assert.deepEqual((await call("/api/whatsapp/pairings/p1")).data, { state: "qr", qr: "data:image/png;base64,AAA" });
  const gone = await call("/api/whatsapp/pairings/gone");
  assert.equal(gone.data.state, "failed");
  assert.match(gone.data.reason, /expired/);
  assert.equal((await call("/api/whatsapp/pairings/p1", { method: "DELETE" })).status, 200);
  assert.equal((await post("/api/shopee/pairings", {})).status, 400, "Shopee connects by OAuth, not QR");
  ok("pairing: start (label trimmed) → QR poll → expired maps to 'failed'; cancel; Shopee refuses QR pairing");
}

// ─── MOCK_CHAT, overview, token refresh ───

{
  process.env.MOCK_CHAT = "true";
  const list = await call("/api/chat/conversations?shop=uuid-shopee");
  assert.ok(list.data.items.length >= 3);
  assert.ok(list.data.items.every((c: any) => c.id.startsWith("mock-")));
  const c = list.data.items[0];
  await post("/api/chat/send", { shop_id: "uuid-shopee", conversation_id: c.id, peer_id: c.peer_id, text: "test reply" });
  const thread = await call(`/api/chat/messages?shop_id=uuid-shopee&conversation_id=${c.id}`);
  assert.equal(thread.data.messages.at(-1).text, "test reply");
  assert.equal(thread.data.messages.at(-1).from, "shop");
  process.env.MOCK_CHAT = "";
  ok("MOCK_CHAT=true: seeded conversations, send appends a shop message");
}
{
  tables.wa_conversations!.find((c) => c.id === "v1")!.unread_count = 2; // the chat check above read it
  const { data } = await call("/api/overview");
  const s = data.shops.find((x: any) => x.shop_id === "uuid-shopee");
  const w = data.shops.find((x: any) => x.shop_id === "uuid-wa");
  assert.equal(s.today.ok, true);
  assert.equal(s.chats.data.conversations, 1);
  assert.deepEqual(s.products.data.low_stock, [{ id: "1", name: "Cat food 1.5kg", stock: 3 }]);
  assert.equal(w.today, null, "WhatsApp has no orders → null, not an error");
  assert.equal(w.products, null);
  assert.deepEqual(w.chats, { ok: true, data: { conversations: 1, messages: 2 } });
  ok("/overview: Shopee sections load; WhatsApp unread chats counted, its orders/products null (unsupported)");
}
{
  tables.shop_tokens![0]!.access_expires_at = new Date(Date.now() + 60e3).toISOString(); // inside the 10-min margin
  dbWrites.length = 0;
  shopeeCalls.length = 0;
  await call("/api/vouchers?shop=uuid-shopee");
  assert.deepEqual(calls("/api/v2/auth/access_token/get")[0]!.body, { refresh_token: "shopee-refresh", shop_id: 111, partner_id: 1234187 });
  const saved = dbWrites.find((w) => w.table === "shop_tokens" && w.method === "POST")!.body;
  assert.equal(decrypt(saved.access_token_enc), "shopee-access-2");
  assert.equal(decrypt(saved.refresh_token_enc), "shopee-refresh-2");
  assert.ok(new Date(saved.refresh_expires_at).getTime() - Date.now() > 29 * 86400e3);
  assert.equal(calls("/api/v2/voucher/get_voucher_list")[0]!.params.get("access_token"), "shopee-access-2");
  ok("token refresh: expiring token refreshed, rotated tokens saved encrypted (30-day refresh TTL), new token used");
}

// ─── Shopee OAuth, webhooks, password gate ───

{
  const start = await call("/api/shopee/authorize");
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.get("location")!);
  assert.equal(loc.origin + loc.pathname, "https://partner.shopeemobile.com/api/v2/shop/auth_partner");
  const redirect = new URL(loc.searchParams.get("redirect")!);
  const state = redirect.searchParams.get("state")!;
  assert.equal(redirect.origin + redirect.pathname, "https://example.vercel.app/api/shopee/callback");
  assert.match(start.headers.get("set-cookie")!, new RegExp(`oauth_state_shopee=${state}`));
  const bad = await call(`/api/shopee/callback?code=c&shop_id=333&state=${state}`, { headers: { Cookie: "oauth_state_shopee=wrong" } });
  assert.match(decodeURIComponent(bad.headers.get("location")!), /Invalid or expired state/);
  dbWrites.length = 0;
  const done = await call(`/api/shopee/callback?code=c&shop_id=333&state=${state}`, { headers: { Cookie: `oauth_state_shopee=${state}` } });
  assert.equal(done.headers.get("location"), "/dashboard?shop=uuid-new");
  const shopRow = dbWrites.find((w) => w.table === "shops" && w.method === "POST")!;
  assert.equal(shopRow.body.platform, "shopee");
  assert.equal(shopRow.body.external_id, "333");
  assert.equal(shopRow.body.shop_name, "Oreo Pet Shop");
  assert.match(shopRow.url, /on_conflict=platform%2Cexternal_id|on_conflict=platform,external_id/);
  assert.equal(decrypt(dbWrites.find((w) => w.table === "shop_tokens" && w.method === "POST")!.body.access_token_enc), "new-access");
  assert.equal((await call("/api/whatsapp/authorize")).status, 400);
  assert.equal((await call("/api/lazada/authorize")).status, 404);
  ok("OAuth: authorize → Shopee with state in redirect; bad state rejected; callback saves shop + encrypted tokens; WhatsApp 400, unknown 404");
}
// Shopee signs the PUBLIC url it posted to (the redirect's origin); behind the Vercel rewrite the API
// sees its own host, so it must verify against the public one.
const shopeeSig = (body: string, origin = "https://example.vercel.app") =>
  crypto.createHmac("sha256", PARTNER_KEY).update(`${origin}/api/shopee/webhook|${body}`).digest("hex");
{
  const body = JSON.stringify({ code: 3, shop_id: 111 });
  assert.equal((await call("/api/shopee/webhook", { method: "POST", body, headers: { Authorization: shopeeSig(body) } })).status, 200);
  assert.equal((await call("/api/shopee/webhook", { method: "POST", body, headers: { Authorization: shopeeSig(body, "http://localhost") } })).status, 401, "signed over the internal host → rejected");
  assert.equal((await call("/api/shopee/webhook", { method: "POST", body, headers: { Authorization: "00".repeat(32) } })).status, 401);
  assert.equal((await call("/api/whatsapp/webhook", { method: "POST", body: "{}" })).status, 404, "WhatsApp has no webhook (the worker holds the socket)");
  ok("webhooks: Shopee HMAC over the public url accepted, internal-host or forged signature rejected; WhatsApp has none");
}
{
  process.env.APP_PASSWORD = "pw";
  assert.equal((await call("/api/products")).status, 401);
  assert.equal((await call("/api/platforms")).status, 401);
  const body = JSON.stringify({ code: 1 });
  assert.equal((await call("/api/shopee/webhook", { method: "POST", body, headers: { Authorization: shopeeSig(body) } })).status, 200);
  assert.equal((await call("/api/shopee/callback?state=x")).status, 302, "callback reachable without login");
  assert.equal((await call("/api/shopee/authorize")).status, 401, "starting a connect needs login");
  assert.equal((await post("/api/whatsapp/pairings", {})).status, 401, "starting a QR pairing needs login");
  assert.equal((await call("/api/chat/webhook", { method: "POST", body: "{}" })).status, 401, "non-platform path not exempted");
  const login = await post("/api/login", { password: "pw" });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  assert.equal((await call("/api/shops", { headers: { Cookie: cookie } })).status, 200);
  process.env.APP_PASSWORD = "";
  ok("password gate: data + connect need login; only real platforms' callback/webhook are public");
}

console.log(`\n${results.length} checks passed:\n${results.join("\n")}`);
