import crypto from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { describePlatforms, getAdapter, getCapability, isPlatform } from "../adapters/factory.js";
import type { Conversation, Order } from "../adapters/types.js";
import { computeAuthToken, isLockEnabled } from "../lib/appAuth.js";
import { computeBasket, orderSizeBucket } from "../lib/analytics.js";
import { matchRule, rules, suggestReply } from "../lib/chatbot.js";
import { assertCoreConfig } from "../lib/config.js";
import { generateReply, getLlmConfig, KEY_ENV } from "../lib/llm.js";
import { findShop, listShops, merge, perShop, resolveShops } from "../lib/shops.js";
import { supabase } from "../lib/supabase.js";
import { getCredentials, saveTokens } from "../lib/tokens.js";

export const app = new Hono().basePath("/api");

// Any uncaught error (platform API, Supabase, missing env) → JSON 500 the pages can show.
app.onError((e, c) => c.json({ error: String(e) }, 500));

// ─────────────────────────────────────────────────────────────
// Password gate. Reachable without login:
//  - login/logout             → the gate itself
//  - <platform>/callback|webhook → the platforms' redirects and servers must reach these
// ─────────────────────────────────────────────────────────────
const PUBLIC = ["/api/login", "/api/logout", "/api/health"];
const PLATFORM_PUBLIC = /^\/api\/([a-z]+)\/(callback|webhook)$/;

app.use(async (c, next) => {
  const platformHook = PLATFORM_PUBLIC.exec(c.req.path);
  if (!isLockEnabled() || PUBLIC.includes(c.req.path) || (platformHook && isPlatform(platformHook[1]!))) return next();
  if (getCookie(c, "app_auth") === (await computeAuthToken())) return next();
  return c.json({ error: "unauthorized" }, 401);
});

/** Railway health check; public so it passes with the password lock on. */
app.get("/health", (c) => c.json({ ok: true }));

/** Pages call this on load; 401 (from the gate above) sends them to /login. */
app.get("/session", (c) => c.json({ ok: true }));

app.post("/login", async (c) => {
  const { password } = await c.req.json<{ password?: string }>();
  const expected = process.env.APP_PASSWORD ?? "";
  if (!expected || password !== expected) return c.json({ error: "Wrong password" }, 401);

  setCookie(c, "app_auth", await computeAuthToken(), {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production", // https on Vercel, http on localhost
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return c.json({ ok: true });
});

app.post("/logout", (c) => {
  deleteCookie(c, "app_auth", { path: "/" });
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// Platforms: connect (OAuth) + webhooks, one set of routes for every platform.
// Shopee's registered redirect stays /api/shopee/callback.
// ─────────────────────────────────────────────────────────────

app.get("/platforms", (c) => c.json({ platforms: describePlatforms() }));

const stateCookie = (platform: string) => `oauth_state_${platform}`;

/** The platform's connect capability, checked to be usable; a Response means "stop, return this". */
function connectFor(c: Context, platform: string) {
  if (!isPlatform(platform)) return c.json({ error: `Unknown platform: ${platform}` }, 404);
  const adapter = getAdapter(platform);
  if (!adapter.connect) return c.json({ error: `${adapter.label} can't be connected from here yet` }, 400);
  const missing = adapter.missingConfig();
  if (missing.length) throw new Error(`Missing env: ${missing.join(", ")}`);
  assertCoreConfig();
  return adapter.connect;
}

/**
 * Start the OAuth flow. Random `state` goes in a short-lived httpOnly cookie and in the
 * redirect URL; the callback checks they match (CSRF guard).
 */
app.get("/:platform/authorize", (c) => {
  const platform = c.req.param("platform");
  const connect = connectFor(c, platform);
  if (connect instanceof Response) return connect;

  const state = crypto.randomBytes(16).toString("hex");
  setCookie(c, stateCookie(platform), state, { httpOnly: true, sameSite: "Lax", maxAge: 600, path: "/" });
  return c.redirect(connect.authorizeUrl(state));
});

/** The platform redirects here after the seller authorizes. */
app.get("/:platform/callback", async (c) => {
  const platform = c.req.param("platform");
  const fail = (msg: string) => c.redirect(`/connect?error=${encodeURIComponent(msg)}`);
  let connect;
  try {
    connect = connectFor(c, platform);
  } catch (e) {
    return fail(String(e));
  }
  if (connect instanceof Response) return connect;

  const query = c.req.query();
  const cookieState = getCookie(c, stateCookie(platform));
  if (!query.state || !cookieState || cookieState !== query.state) {
    return fail("Invalid or expired state token. Please click Connect again.");
  }

  try {
    const { externalId, name, tokens } = await connect.completeAuthorization(query);
    const { data: shop, error } = await supabase
      .from("shops")
      .upsert(
        { platform, external_id: externalId, shop_name: name, connected_at: new Date().toISOString(), disconnected_at: null },
        { onConflict: "platform,external_id" },
      )
      .select("id")
      .single();
    if (error || !shop) return fail(`DB error: ${error?.message ?? "no shop returned"}`);

    await saveTokens(shop.id, tokens);
    deleteCookie(c, stateCookie(platform), { path: "/" });
    return c.redirect(`/dashboard?shop=${shop.id}`);
  } catch (e) {
    return fail(`${getAdapter(platform).label} error: ${String(e)}`);
  }
});

/**
 * QR pairing (WhatsApp). The browser starts a pairing, then polls it every ~2s to show the
 * current QR; on "connected" the platform has already created the shop.
 */
function pairingFor(c: Context, platform: string) {
  if (!isPlatform(platform)) return c.json({ error: `Unknown platform: ${platform}` }, 404);
  const adapter = getAdapter(platform);
  if (!adapter.pairing) return c.json({ error: `${adapter.label} doesn't pair by QR code` }, 400);
  const missing = adapter.missingConfig();
  if (missing.length) throw new Error(`Missing env: ${missing.join(", ")}`);
  return adapter.pairing;
}

app.post("/:platform/pairings", async (c) => {
  const pairing = pairingFor(c, c.req.param("platform"));
  if (pairing instanceof Response) return pairing;
  const { label } = await c.req.json<{ label?: string }>().catch(() => ({ label: undefined }));
  const { pairingId } = await pairing.start(label?.trim() || undefined);
  return c.json({ pairing_id: pairingId });
});

app.get("/:platform/pairings/:id", async (c) => {
  const pairing = pairingFor(c, c.req.param("platform"));
  if (pairing instanceof Response) return pairing;
  return c.json(await pairing.status(c.req.param("id")));
});

app.delete("/:platform/pairings/:id", async (c) => {
  const pairing = pairingFor(c, c.req.param("platform"));
  if (pairing instanceof Response) return pairing;
  await pairing.cancel(c.req.param("id"));
  return c.json({ ok: true });
});

/** Webhook subscription check, for platforms that do a GET handshake (Shopee doesn't). */
app.get("/:platform/webhook", (c) => {
  const platform = c.req.param("platform");
  const hook = isPlatform(platform) ? getCapability(platform, "webhook") : null;
  const answer = hook?.challenge?.(c.req.query());
  return answer == null ? c.json({ error: "forbidden" }, 403) : c.text(answer);
});

app.post("/:platform/webhook", async (c) => {
  const platform = c.req.param("platform");
  const hook = isPlatform(platform) ? getCapability(platform, "webhook") : null;
  if (!hook) return c.json({ error: "no webhook for this platform" }, 404);

  const body = await c.req.text();
  if (!hook.verify({ url: c.req.url, body, header: (name) => c.req.header(name) })) {
    return c.json({ error: "bad signature" }, 401);
  }
  await hook.handle(body);
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// Shop data. Reads take `?shop=all` (default) or `?shop=<uuid>` and fan out per shop in
// parallel, skipping shops whose platform lacks the feature; list responses are
// `{ items, errors }` with every row tagged shop_id/shop_name.
// Writes take `shop_id` explicitly — never an implicit "current shop" — so an edit always
// lands on the shop of the row it was made from.
// ─────────────────────────────────────────────────────────────

app.get("/shops", async (c) => c.json({ shops: await listShops() }));

const daysAgo = (days: number) => new Date(Date.now() - days * 86400_000);
const shopsOf = (c: Context) => resolveShops(c.req.query("shop"));

app.get("/products", async (c) => {
  return c.json(merge(await perShop(await shopsOf(c), "catalog", (catalog, creds) => catalog.list(creds))));
});

app.post("/products", async (c) => {
  const body = await c.req.json<{ shop_id?: string; product_id?: string; price?: number }>();
  const shop = await findShop(body.shop_id);
  if (!shop) return c.json({ error: "shop_id required (the shop this product belongs to)" }, 400);
  if (!body.product_id || !(Number(body.price) > 0)) return c.json({ error: "product_id and a price > 0 required" }, 400);
  const catalog = getCapability(shop.platform, "catalog");
  if (!catalog) return c.json({ error: `${shop.platform} has no products` }, 400);
  await catalog.updatePrice(await getCredentials(shop), body.product_id, Number(body.price));
  return c.json({ ok: true });
});

app.get("/orders", async (c) => {
  const since = daysAgo(Number(c.req.query("days") ?? 7));
  const res = merge(await perShop(await shopsOf(c), "orders", (orders, creds) => orders.list(creds, since)));
  res.items.sort((a, b) => b.created_at - a.created_at); // newest first across shops
  return c.json(res);
});

app.get("/vouchers", async (c) => {
  return c.json(merge(await perShop(await shopsOf(c), "promotions", (p, creds) => p.listVouchers(creds))));
});

app.get("/ads", async (c) => {
  const start = c.req.query("start_date") ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const end = c.req.query("end_date") ?? new Date().toISOString().slice(0, 10);
  return c.json(merge(await perShop(await shopsOf(c), "ads", (ads, creds) => ads.report(creds, { start, end }))));
});

// Orders are read live, so the window is capped: on Shopee 30 days ≈ 2 order-list windows + 1 detail call per 50 orders, per shop.
const MAX_INSIGHT_DAYS = 30;
const round2 = (x: number) => Math.round(x * 100) / 100;
const sales = (orders: Order[]) => orders.filter((o) => o.counts_as_sale);

/**
 * Sales by product, basket pairs, order-size distribution + a per-shop comparison.
 * Product ids are per shop, so product rows and basket pairs stay tagged with their shop.
 */
app.get("/insights", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? MAX_INSIGHT_DAYS), MAX_INSIGHT_DAYS);
  const since = daysAgo(days);
  const results = await perShop(await shopsOf(c), "orders", (orders, creds) => orders.list(creds, since));
  const tag = (r: (typeof results)[number]) => ({ shop_id: r.shop_id, shop_name: r.shop_name });

  const byProductRows: Array<{ shop_id: string; shop_name: string; product_id: string; name: string; qty: number; revenue: number }> = [];
  const basket: Array<ReturnType<typeof computeBasket>[number] & { shop_id: string; shop_name: string }> = [];
  const byShop: Array<{ shop_id: string; shop_name: string; orders: number; revenue: number }> = [];
  const buckets = new Map<string, { orders: number; revenue: number }>();
  const errors: Array<{ shop_id: string; shop_name: string; error: string }> = [];

  for (const r of results) {
    if (!r.ok) {
      errors.push({ ...tag(r), error: r.error });
      continue;
    }
    const orders = sales(r.data);

    const byProduct = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const line of orders.flatMap((o) => o.lines)) {
      const e = byProduct.get(line.product_id) ?? { name: line.name, qty: 0, revenue: 0 };
      e.qty += line.qty;
      e.revenue += line.unit_price * line.qty;
      byProduct.set(line.product_id, e);
    }
    for (const [product_id, v] of byProduct) byProductRows.push({ ...tag(r), product_id, ...v, revenue: round2(v.revenue) });

    for (const o of orders) {
      const b = orderSizeBucket(o.total);
      const e = buckets.get(b) ?? { orders: 0, revenue: 0 };
      e.orders++;
      e.revenue += o.total;
      buckets.set(b, e);
    }

    basket.push(...computeBasket(orders).map((p) => ({ ...p, ...tag(r) })));
    byShop.push({ ...tag(r), orders: orders.length, revenue: round2(orders.reduce((s, o) => s + o.total, 0)) });
  }

  byProductRows.sort((a, b) => b.revenue - a.revenue);
  basket.sort((a, b) => b.lift - a.lift);
  const sizes = [...buckets.entries()].map(([bucket, v]) => ({ bucket, ...v, revenue: round2(v.revenue) }));
  return c.json({ days, by_shop: byShop, sales: byProductRows, sizes, basket: basket.slice(0, 50), errors });
});

// ─────────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────────

// Shops are in Malaysia → "today" is Malaysia time (UTC+8, no DST).
const MY_UTC_OFFSET_MS = 8 * 3600_000;
// "Low stock" = at or below this many units. Env-tunable per shop owner's taste.
const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD ?? 5);
// ponytail: 10 pages × 60 = 600 unread conversations max per shop; add a "600+" flag if a shop ever gets there.
const MAX_CHAT_PAGES = 10;

type Section<T> = { ok: true; data: T } | { ok: false; error: string };
/** One platform failure shouldn't blank the whole page — each card reports its own error. */
const section = async <T>(fn: () => Promise<T>): Promise<Section<T>> => {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
};

/**
 * Per shop: today's sales, unread chats, products/low stock — each section fails independently,
 * and is null when the shop's platform doesn't have that feature.
 */
app.get("/overview", async (c) => {
  const now = Date.now();
  const todayStart = new Date(Math.floor((now + MY_UTC_OFFSET_MS) / 86400_000) * 86400_000 - MY_UTC_OFFSET_MS);

  const shops = await Promise.all(
    (await shopsOf(c)).map(async (shop) => {
      const tag = { shop_id: shop.id, shop_name: shop.shop_name };
      const adapter = getAdapter(shop.platform);
      const creds = await section(() => getCredentials(shop));
      const run = <C, T>(cap: C | undefined, fn: (impl: C, creds: Awaited<ReturnType<typeof getCredentials>>) => Promise<T>) =>
        !cap ? null : !creds.ok ? creds : section(() => fn(cap, creds.data));

      const [today, chats, products] = await Promise.all([
        run(adapter.orders, async (orders, cr) => {
          const paid = sales(await orders.list(cr, todayStart));
          const revenue = paid.reduce((sum, o) => sum + o.total, 0);
          return { orders: paid.length, revenue: round2(revenue), currency: paid[0]?.currency ?? "MYR" };
        }),
        run(adapter.chat, async (chat, cr) => {
          let conversations = 0, messages = 0, cursor: string | undefined;
          for (let page = 0; page < MAX_CHAT_PAGES; page++) {
            const r = await chat.listConversations(cr, { unreadOnly: true, cursor });
            conversations += r.conversations.length;
            messages += r.conversations.reduce((sum, cv) => sum + cv.unread, 0);
            if (!r.next) break;
            cursor = r.next;
          }
          return { conversations, messages };
        }),
        run(adapter.catalog, async (catalog, cr) => {
          const items = await catalog.list(cr);
          const lowStock = items
            .filter((it) => it.stock != null && it.stock <= LOW_STOCK_THRESHOLD)
            .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0))
            .map(({ id, name, stock }) => ({ id, name, stock }));
          return { total: items.length, low_stock: lowStock };
        }),
      ]);
      return { ...tag, platform: shop.platform, today, chats, products };
    }),
  );

  return c.json({ low_stock_threshold: LOW_STOCK_THRESHOLD, shops });
});

// ─────────────────────────────────────────────────────────────
// Chat — one inbox across shops and platforms; reading a thread / sending always names its shop.
// ─────────────────────────────────────────────────────────────

/** Latest conversations per shop (first page each), merged newest first. type=all|unread. */
app.get("/chat/conversations", async (c) => {
  const unreadOnly = c.req.query("type") === "unread";
  const res = merge<Conversation>(
    await perShop(await shopsOf(c), "chat", async (chat, creds) => (await chat.listConversations(creds, { unreadOnly })).conversations),
  );
  res.items.sort((a, b) => (b.last_at ?? 0) - (a.last_at ?? 0));
  return c.json(res);
});

app.get("/chat/messages", async (c) => {
  const shop = await findShop(c.req.query("shop_id"));
  const conversationId = c.req.query("conversation_id");
  if (!shop || !conversationId) return c.json({ error: "shop_id and conversation_id required" }, 400);
  const chat = getCapability(shop.platform, "chat");
  if (!chat) return c.json({ error: `${shop.platform} has no chat` }, 400);
  return c.json({ messages: await chat.listMessages(await getCredentials(shop), conversationId) });
});

app.post("/chat/send", async (c) => {
  const { shop_id, conversation_id, peer_id, text } = await c.req.json<{
    shop_id?: string;
    conversation_id?: string;
    peer_id?: string;
    text?: string;
  }>();
  const shop = await findShop(shop_id);
  if (!shop) return c.json({ error: "shop_id required (the shop this conversation belongs to)" }, 400);
  if (!conversation_id || !peer_id || !text?.trim()) return c.json({ error: "conversation_id, peer_id and text required" }, 400);
  const chat = getCapability(shop.platform, "chat");
  if (!chat) return c.json({ error: `${shop.platform} has no chat` }, 400);
  await chat.send(await getCredentials(shop), { conversationId: conversation_id, peerId: peer_id }, text.trim());
  return c.json({ ok: true });
});

app.post("/chat/suggest", async (c) => {
  const { buyer_message } = await c.req.json<{ buyer_message: string }>();

  // 1. Rules first (config/chatbot.json), 2. then the LLM
  const ruleHit = matchRule(buyer_message, rules);
  if (ruleHit) return c.json({ source: "rule", reply: ruleHit.reply, rule_name: ruleHit.rule_name });
  return c.json({ source: "llm", reply: await suggestReply(buyer_message) });
});

// ─────────────────────────────────────────────────────────────
// AI settings (read-only — configured via env, see lib/llm.ts getLlmConfig)
// ─────────────────────────────────────────────────────────────

app.get("/settings", (c) => {
  const { provider, model, apiKey } = getLlmConfig();
  return c.json({ provider, model, hasKey: !!apiKey, keyEnv: KEY_ENV[provider] });
});

app.post("/settings/test", async (c) => {
  try {
    const reply = await generateReply(getLlmConfig(), "You are a helpful assistant. Reply in a few words only.", "Reply with exactly: connection ok");
    return c.json({ ok: true, reply });
  } catch (e) {
    return c.json({ ok: false, error: String(e) });
  }
});
