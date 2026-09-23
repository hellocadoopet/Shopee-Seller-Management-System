import crypto from "node:crypto";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { config, assertConfig } from "../lib/config";
import { computeAuthToken, isLockEnabled } from "../lib/appAuth";
import { listShops, merge, perShop, resolveShops, type Shop } from "../lib/shops";
import { supabase } from "../lib/supabase";
import { getFreshAccessToken, saveTokens } from "../lib/tokens";
import {
  buildAuthUrl,
  exchangeCodeForToken,
  getShopInfo,
  getAdsPerformance,
  getVoucherList,
  updateItemPrice,
} from "../lib/shopee";
import { fetchOrders } from "../lib/orders";
import { listProducts } from "../lib/products";
import { listConversations, listMessages, send } from "../lib/chat";
import { computeBasket, orderSizeBucket } from "../lib/analytics";
import { matchRule, rules, suggestReply } from "../lib/chatbot";
import { generateReply, getLlmConfig, KEY_ENV } from "../lib/llm";

export const app = new Hono().basePath("/api");

// Any uncaught error (Shopee, Supabase, missing env) → JSON 500 the pages can show.
app.onError((e, c) => c.json({ error: String(e) }, 500));

// ─────────────────────────────────────────────────────────────
// Password gate. Reachable without login:
//  - login/logout      → the gate itself
//  - shopee callback/webhook → Shopee's servers/redirects must reach these
// ─────────────────────────────────────────────────────────────
const PUBLIC = ["/api/login", "/api/logout", "/api/shopee/callback", "/api/shopee/webhook"];

app.use(async (c, next) => {
  if (!isLockEnabled() || PUBLIC.includes(c.req.path)) return next();
  if (getCookie(c, "app_auth") === (await computeAuthToken())) return next();
  return c.json({ error: "unauthorized" }, 401);
});

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
// Shopee OAuth + webhook
// ─────────────────────────────────────────────────────────────

/**
 * Start the OAuth flow. Random `state` goes in a short-lived httpOnly cookie and
 * in the redirect URL; the callback checks they match (CSRF guard).
 */
app.get("/shopee/authorize", (c) => {
  assertConfig();
  const state = crypto.randomBytes(16).toString("hex");

  const url = new URL(buildAuthUrl());
  const redirect = new URL(url.searchParams.get("redirect") ?? "");
  redirect.searchParams.set("state", state);
  url.searchParams.set("redirect", redirect.toString());

  setCookie(c, "shopee_oauth_state", state, { httpOnly: true, sameSite: "Lax", maxAge: 600, path: "/" });
  return c.redirect(url.toString());
});

/** Shopee redirects here after the seller authorizes. Query: code, shop_id, state. */
app.get("/shopee/callback", async (c) => {
  assertConfig();
  const fail = (msg: string) => c.redirect(`/connect?error=${encodeURIComponent(msg)}`);

  const { code, shop_id, state } = c.req.query();
  if (!code || !shop_id || !state) return fail("Missing code, shop_id, or state from Shopee redirect.");
  const shopeeShopId = Number(shop_id);

  const cookieState = getCookie(c, "shopee_oauth_state");
  if (!cookieState || cookieState !== state) {
    return fail("Invalid or expired state token. Please click Connect again.");
  }

  try {
    const tokens = await exchangeCodeForToken(code, shopeeShopId);

    let shopName: string | null = null;
    try {
      shopName = (await getShopInfo(tokens.access_token, shopeeShopId)).shop_name;
    } catch {
      // Non-fatal — we can fill in later
    }

    const { data: shop, error } = await supabase
      .from("shops")
      .upsert(
        { shopee_shop_id: shopeeShopId, shop_name: shopName, connected_at: new Date().toISOString(), disconnected_at: null },
        { onConflict: "shopee_shop_id" },
      )
      .select("id")
      .single();
    if (error || !shop) return fail(`DB error: ${error?.message ?? "no shop returned"}`);

    await saveTokens(shop.id, tokens.access_token, tokens.refresh_token, tokens.expire_in);

    deleteCookie(c, "shopee_oauth_state", { path: "/" });
    return c.redirect(`/dashboard?shop=${shop.id}`);
  } catch (e) {
    return fail(`Shopee error: ${String(e)}`);
  }
});

/**
 * Shopee push notifications — verify the HMAC signature before trusting.
 * Common codes: 1=shop_authorization, 3=order_status, 10=new_message, 12=item_promotion
 */
app.post("/shopee/webhook", async (c) => {
  const sig = c.req.header("authorization");
  const rawBody = await c.req.text();
  if (!sig) return c.json({ error: "no signature" }, 401);

  // ponytail: signs c.req.url as received; if Shopee's registered URL differs (proxy/https rewrite), rebuild it from x-forwarded-* headers.
  const expected = crypto.createHmac("sha256", config.shopee.partnerKey.trim()).update(`${c.req.url}|${rawBody}`).digest("hex");
  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return c.json({ error: "bad signature" }, 401);
  }

  const body = JSON.parse(rawBody) as { code: number; shop_id?: number };
  // TODO route by code: 3 → schedule order sync, 10 → trigger auto-reply rule
  console.log("Shopee webhook:", { code: body.code, shop_id: body.shop_id });
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// Shop data. Reads take `?shop=all` (default) or `?shop=<uuid>` and fan out per shop in
// parallel; list responses are `{ items, errors }` with every row tagged shop_id/shop_name.
// Writes take `shop_id` explicitly — never an implicit "current shop" — so an edit always
// lands on the shop of the row it was made from.
// ─────────────────────────────────────────────────────────────

app.get("/shops", async (c) => c.json({ shops: await listShops() }));

const daysAgo = (days: number) => Math.floor(Date.now() / 1000) - days * 86400;
const shopsOf = (c: { req: { query: (k: string) => string | undefined } }) => resolveShops(c.req.query("shop"));

/** Resolve the single shop a write targets; null → caller returns 400. */
async function writeTarget(shopId: string | undefined): Promise<Shop | null> {
  if (!shopId) return null;
  return (await listShops()).find((s) => s.id === shopId) ?? null;
}

app.get("/products", async (c) => {
  return c.json(merge(await perShop(await shopsOf(c), (_, auth) => listProducts(auth))));
});

app.post("/products", async (c) => {
  const body = await c.req.json<{
    shop_id?: string;
    item_id: number;
    price_list: Array<{ model_id?: number; original_price: number }>;
  }>();
  const shop = await writeTarget(body.shop_id);
  if (!shop) return c.json({ error: "shop_id required (the shop this item belongs to)" }, 400);
  const auth = await getFreshAccessToken(shop.id);
  return c.json(await updateItemPrice(auth.accessToken, auth.shopeeShopId, body.item_id, body.price_list));
});

app.get("/orders", async (c) => {
  const since = daysAgo(Number(c.req.query("days") ?? 7));
  const res = merge(await perShop(await shopsOf(c), (shop) => fetchOrders(shop.id, since)));
  res.items.sort((a, b) => b.create_time - a.create_time); // newest first across shops
  return c.json(res);
});

app.get("/vouchers", async (c) => {
  return c.json(
    merge(
      await perShop(await shopsOf(c), async (_, auth) => {
        const res = await getVoucherList(auth.accessToken, auth.shopeeShopId, "all");
        return res.voucher_list ?? []; // Shopee sends null when there are none
      }),
    ),
  );
});

app.get("/ads", async (c) => {
  const start = c.req.query("start_date") ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const end = c.req.query("end_date") ?? new Date().toISOString().slice(0, 10);
  return c.json(
    merge(
      await perShop(await shopsOf(c), async (_, auth) => {
        const res = await getAdsPerformance(auth.accessToken, auth.shopeeShopId, start, end);
        return res.report_list ?? [];
      }),
    ),
  );
});

// Live from Shopee, so the window is capped: 30 days ≈ 2 order-list windows + 1 detail call per 50 orders, per shop.
const MAX_INSIGHT_DAYS = 30;
// Orders that count as sales: skip ones not paid yet or being cancelled.
const NOT_SALES = new Set(["UNPAID", "IN_CANCEL", "CANCELLED"]);
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Sales by product, basket pairs, order-size distribution + a per-shop comparison.
 * Item IDs are per shop, so product rows and basket pairs stay tagged with their shop.
 */
app.get("/insights", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? MAX_INSIGHT_DAYS), MAX_INSIGHT_DAYS);
  const since = daysAgo(days);
  const results = await perShop(await shopsOf(c), (shop) => fetchOrders(shop.id, since));
  const tag = (r: (typeof results)[number]) => ({ shop_id: r.shop_id, shop_name: r.shop_name });

  const sales: Array<{ shop_id: string; shop_name: string; item_id: number; item_name: string; qty: number; revenue: number }> = [];
  const basket: Array<ReturnType<typeof computeBasket>[number] & { shop_id: string; shop_name: string }> = [];
  const byShop: Array<{ shop_id: string; shop_name: string; orders: number; revenue: number }> = [];
  const buckets = new Map<string, { orders: number; revenue: number }>();
  const errors: Array<{ shop_id: string; shop_name: string; error: string }> = [];

  for (const r of results) {
    if (!r.ok) {
      errors.push({ ...tag(r), error: r.error });
      continue;
    }
    const orders = r.data.filter((o) => !NOT_SALES.has(o.order_status));

    const byProduct = new Map<number, { item_name: string; qty: number; revenue: number }>();
    for (const it of orders.flatMap((o) => o.item_list ?? [])) {
      const e = byProduct.get(it.item_id) ?? { item_name: it.item_name ?? `#${it.item_id}`, qty: 0, revenue: 0 };
      e.qty += it.model_quantity_purchased;
      e.revenue += Number(it.model_discounted_price) * it.model_quantity_purchased;
      byProduct.set(it.item_id, e);
    }
    for (const [item_id, v] of byProduct) sales.push({ ...tag(r), item_id, ...v, revenue: round2(v.revenue) });

    for (const o of orders) {
      const b = orderSizeBucket(Number(o.total_amount));
      const e = buckets.get(b) ?? { orders: 0, revenue: 0 };
      e.orders++;
      e.revenue += Number(o.total_amount);
      buckets.set(b, e);
    }

    basket.push(...computeBasket(orders).map((p) => ({ ...p, ...tag(r) })));
    byShop.push({ ...tag(r), orders: orders.length, revenue: round2(orders.reduce((s, o) => s + Number(o.total_amount), 0)) });
  }

  sales.sort((a, b) => b.revenue - a.revenue);
  basket.sort((a, b) => b.lift - a.lift);
  const sizes = [...buckets.entries()].map(([bucket, v]) => ({ bucket, ...v, revenue: round2(v.revenue) }));
  return c.json({ days, by_shop: byShop, sales, sizes, basket: basket.slice(0, 50), errors });
});

// ─────────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────────

// Shops are Shopee MY → "today" is Malaysia time (UTC+8, no DST).
const MY_UTC_OFFSET = 8 * 3600;
// "Low stock" = at or below this many units. Env-tunable per shop owner's taste.
const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD ?? 5);
// ponytail: 10 pages × 60 = 600 unread conversations max per shop; add a "600+" flag if a shop ever gets there.
const MAX_CHAT_PAGES = 10;

type Section<T> = { ok: true; data: T } | { ok: false; error: string };
/** One Shopee failure shouldn't blank the whole page — each card reports its own error. */
const section = async <T>(fn: () => Promise<T>): Promise<Section<T>> => {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
};

/** Per shop: today's sales, unread chats, products/low stock — each section fails independently. */
app.get("/overview", async (c) => {
  const now = Math.floor(Date.now() / 1000);
  const todayStart = Math.floor((now + MY_UTC_OFFSET) / 86400) * 86400 - MY_UTC_OFFSET;

  const shops = await Promise.all(
    (await shopsOf(c)).map(async (shop) => {
      const tag = { shop_id: shop.id, shop_name: shop.shop_name };
      const auth = await section(() => getFreshAccessToken(shop.id));
      if (!auth.ok) return { ...tag, today: auth, chats: auth, products: auth };

      const [today, chats, products] = await Promise.all([
        section(async () => {
          const sales = (await fetchOrders(shop.id, todayStart)).filter((o) => !NOT_SALES.has(o.order_status));
          const revenue = sales.reduce((sum, o) => sum + Number(o.total_amount), 0);
          return { orders: sales.length, revenue: round2(revenue), currency: sales[0]?.currency ?? "MYR" };
        }),
        section(async () => {
          let conversations = 0, messages = 0, cursor = "";
          for (let page = 0; page < MAX_CHAT_PAGES; page++) {
            const r = await listConversations(auth.data, "unread", cursor);
            conversations += r.conversations.length;
            messages += r.conversations.reduce((sum, cv) => sum + (cv.unread_count ?? 0), 0);
            if (!r.more) break;
            cursor = r.next;
          }
          return { conversations, messages };
        }),
        section(async () => {
          const items = await listProducts(auth.data);
          const lowStock = items
            .filter((it) => it.stock != null && it.stock <= LOW_STOCK_THRESHOLD)
            .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0))
            .map(({ item_id, item_name, stock }) => ({ item_id, item_name, stock }));
          return { total: items.length, low_stock: lowStock };
        }),
      ]);
      return { ...tag, today, chats, products };
    }),
  );

  return c.json({ low_stock_threshold: LOW_STOCK_THRESHOLD, shops });
});

// ─────────────────────────────────────────────────────────────
// Chat — one inbox across shops; reading a thread / sending always names its shop.
// ─────────────────────────────────────────────────────────────

/** Latest conversations per shop (first page, up to 60 each), merged newest first. type=all|unread. */
app.get("/chat/conversations", async (c) => {
  const type = c.req.query("type") === "unread" ? "unread" : "all";
  const res = merge(
    await perShop(await shopsOf(c), async (_, auth) => {
      return (await listConversations(auth, type)).conversations;
    }),
  );
  res.items.sort((a, b) => (b.last_message_timestamp ?? 0) - (a.last_message_timestamp ?? 0));
  return c.json(res);
});

app.get("/chat/messages", async (c) => {
  const shop = await writeTarget(c.req.query("shop_id"));
  const conversationId = c.req.query("conversation_id");
  if (!shop || !conversationId) return c.json({ error: "shop_id and conversation_id required" }, 400);
  const auth = await getFreshAccessToken(shop.id);
  return c.json({ shopee_shop_id: auth.shopeeShopId, messages: await listMessages(auth, conversationId) });
});

app.post("/chat/send", async (c) => {
  const { shop_id, to_id, text } = await c.req.json<{ shop_id?: string; to_id: number; text: string }>();
  const shop = await writeTarget(shop_id);
  if (!shop) return c.json({ error: "shop_id required (the shop this conversation belongs to)" }, 400);
  if (!to_id || !text?.trim()) return c.json({ error: "to_id and text required" }, 400);
  const auth = await getFreshAccessToken(shop.id);
  await send(auth, to_id, text.trim());
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
