import crypto from "node:crypto";
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { config, assertConfig } from "../lib/config";
import { computeAuthToken, isLockEnabled } from "../lib/appAuth";
import { CURRENT_SHOP_COOKIE, getCurrentShopId } from "../lib/currentShop";
import { supabase } from "../lib/supabase";
import { getFreshAccessToken, saveTokens } from "../lib/tokens";
import {
  buildAuthUrl,
  exchangeCodeForToken,
  getShopInfo,
  getAdsPerformance,
  getItemList,
  getItemBaseInfo,
  getMessageList,
  getVoucherList,
  sendMessage,
  updateItemPrice,
  type ShopeeItemBase,
} from "../lib/shopee";
import { syncOrders } from "../lib/sync";
import { computeBasket, orderSizeBucket } from "../lib/analytics";
import { matchRule, suggestReply } from "../lib/chatbot";
import { getLlmConfig, getSettingsStatus, saveLlmConfig } from "../lib/settings";
import { DEFAULT_MODELS, generateReply, type LlmProvider } from "../lib/llm";

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

    setCookie(c, CURRENT_SHOP_COOKIE, shop.id, { sameSite: "Lax", maxAge: 60 * 60 * 24 * 365, path: "/" });
    deleteCookie(c, "shopee_oauth_state", { path: "/" });
    return c.redirect("/dashboard");
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
// Shop data
// ─────────────────────────────────────────────────────────────

app.get("/shops", async (c) => {
  const { data, error } = await supabase
    .from("shops")
    .select("id, shopee_shop_id, shop_name, region, connected_at")
    .is("disconnected_at", null)
    .order("connected_at", { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ shops: data ?? [] });
});

const shopOf = (c: Context) => getCurrentShopId(getCookie(c, CURRENT_SHOP_COOKIE));
const noShop = (c: Context) => c.json({ error: "no shop connected" }, 400);

app.get("/products", async (c) => {
  const shopId = await shopOf(c);
  if (!shopId) return noShop(c);
  const auth = await getFreshAccessToken(shopId);

  // 1. Item IDs (list endpoint has no prices)
  const list = await getItemList(auth.accessToken, auth.shopeeShopId, 0, 100);
  const ids = list.item.map((i) => i.item_id);
  if (!ids.length) return c.json({ items: [] });

  // 2. Names, prices, stock in batches of 50
  const base: ShopeeItemBase[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await getItemBaseInfo(auth.accessToken, auth.shopeeShopId, ids.slice(i, i + 50));
    base.push(...r.item_list);
  }

  const items = base.map((b) => ({
    item_id: b.item_id,
    item_name: b.item_name,
    item_sku: b.item_sku,
    item_status: b.item_status,
    has_model: b.has_model,
    // price_info only populated for single-variant items; variant items need a model lookup.
    price: b.price_info?.[0]?.current_price ?? null,
    stock: b.stock_info_v2?.summary_info?.total_available_stock ?? null,
  }));
  return c.json({ items });
});

app.post("/products", async (c) => {
  const shopId = await shopOf(c);
  if (!shopId) return noShop(c);
  const body = await c.req.json<{ item_id: number; price_list: Array<{ model_id?: number; original_price: number }> }>();
  const auth = await getFreshAccessToken(shopId);
  return c.json(await updateItemPrice(auth.accessToken, auth.shopeeShopId, body.item_id, body.price_list));
});

/** Fetch orders for the period from Shopee, save them (powers Insights + Overview), return them. */
app.get("/orders", async (c) => {
  const shopId = await shopOf(c);
  if (!shopId) return noShop(c);
  return c.json({ orders: await syncOrders(shopId, Number(c.req.query("days") ?? 7)) });
});

app.get("/vouchers", async (c) => {
  const shopId = await shopOf(c);
  if (!shopId) return noShop(c);
  const auth = await getFreshAccessToken(shopId);
  const res = await getVoucherList(auth.accessToken, auth.shopeeShopId, "all");
  return c.json({ vouchers: res.voucher_list });
});

app.get("/ads", async (c) => {
  const shopId = await shopOf(c);
  if (!shopId) return noShop(c);
  const start = c.req.query("start_date") ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const end = c.req.query("end_date") ?? new Date().toISOString().slice(0, 10);
  const auth = await getFreshAccessToken(shopId);
  const res = await getAdsPerformance(auth.accessToken, auth.shopeeShopId, start, end);
  // Some ads endpoints return no report_list (e.g. account has no ads) — page maps over this.
  return c.json({ reports: res.report_list ?? [] });
});

/** Sales by product, basket pairs, order-size distribution — recomputed from synced orders. */
app.get("/insights", async (c) => {
  const shopId = await shopOf(c);
  if (!shopId) return noShop(c);
  const days = Number(c.req.query("days") ?? 30);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const round = (x: number) => Math.round(x * 100) / 100;

  const { data: items } = await supabase
    .from("shopee_order_items")
    .select("item_id, item_name, qty, discounted_price")
    .eq("shop_id", shopId);

  const byProduct = new Map<number, { item_name: string; qty: number; revenue: number }>();
  for (const it of items ?? []) {
    const entry = byProduct.get(it.item_id) ?? { item_name: it.item_name ?? `#${it.item_id}`, qty: 0, revenue: 0 };
    entry.qty += it.qty;
    entry.revenue += Number(it.discounted_price) * it.qty;
    byProduct.set(it.item_id, entry);
  }
  const sales = [...byProduct.entries()]
    .map(([item_id, v]) => ({ item_id, ...v, revenue: round(v.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);

  const { data: orders } = await supabase
    .from("shopee_orders")
    .select("total_amount")
    .eq("shop_id", shopId)
    .gte("created_at_shopee", since);

  const buckets = new Map<string, { orders: number; revenue: number }>();
  for (const o of orders ?? []) {
    const b = orderSizeBucket(Number(o.total_amount));
    const e = buckets.get(b) ?? { orders: 0, revenue: 0 };
    e.orders++;
    e.revenue += Number(o.total_amount);
    buckets.set(b, e);
  }
  const sizes = [...buckets.entries()].map(([bucket, v]) => ({ bucket, ...v, revenue: round(v.revenue) }));

  const basket = (await computeBasket(shopId)).slice(0, 50);
  return c.json({ sales, sizes, basket });
});

// ─────────────────────────────────────────────────────────────
// Chat
// ─────────────────────────────────────────────────────────────

app.get("/chat/messages", async (c) => {
  const shopId = await shopOf(c);
  if (!shopId) return noShop(c);
  const conversationId = c.req.query("conversation_id");
  if (!conversationId) return c.json({ error: "conversation_id required" }, 400);
  const auth = await getFreshAccessToken(shopId);
  const res = await getMessageList(auth.accessToken, auth.shopeeShopId, conversationId);
  return c.json({ messages: res.messages });
});

app.post("/chat/send", async (c) => {
  const shopId = await shopOf(c);
  if (!shopId) return noShop(c);
  const { to_buyer_id, text, source } = await c.req.json<{
    to_buyer_id: number;
    text: string;
    source: "manual" | "rule" | "llm";
  }>();

  const auth = await getFreshAccessToken(shopId);
  await sendMessage(auth.accessToken, auth.shopeeShopId, to_buyer_id, text);
  await supabase.from("chatbot_replies").insert({
    shop_id: shopId,
    conversation_id: `conv-${to_buyer_id}`,
    triggered_by: source,
    reply_text: text,
  });
  return c.json({ ok: true });
});

app.post("/chat/suggest", async (c) => {
  const shopId = await shopOf(c);
  if (!shopId) return noShop(c);
  const { buyer_message } = await c.req.json<{ buyer_message: string }>();

  // 1. Rules first
  const { data: rules } = await supabase
    .from("chatbot_rules")
    .select("*")
    .eq("shop_id", shopId)
    .eq("active", true)
    .order("priority", { ascending: true });
  const ruleHit = matchRule(buyer_message, rules ?? []);
  if (ruleHit) return c.json({ source: "rule", reply: ruleHit.reply, rule_id: ruleHit.id });

  // 2. Fall back to LLM, past manual replies as style examples
  const { data: history } = await supabase
    .from("chatbot_replies")
    .select("reply_text")
    .eq("shop_id", shopId)
    .eq("triggered_by", "manual")
    .order("sent_at", { ascending: false })
    .limit(20);

  const reply = await suggestReply({
    buyerMessage: buyer_message,
    pastManualReplies: (history ?? []).map((h) => h.reply_text),
  });
  return c.json({ source: "llm", reply });
});

// ─────────────────────────────────────────────────────────────
// AI settings
// ─────────────────────────────────────────────────────────────

const VALID_PROVIDERS: LlmProvider[] = ["claude", "openai", "deepseek"];

app.get("/settings", async (c) => c.json(await getSettingsStatus()));

app.post("/settings", async (c) => {
  const body = await c.req.json<{ provider: LlmProvider; api_key?: string; model?: string }>();
  if (!VALID_PROVIDERS.includes(body.provider)) return c.json({ error: "invalid provider" }, 400);
  const model = body.model?.trim() || DEFAULT_MODELS[body.provider];
  await saveLlmConfig(body.provider, body.api_key?.trim() || null, model);
  return c.json({ ok: true });
});

/** Test the AI connection — with the form's key if sent (verify before saving), else the saved config. */
app.post("/settings/test", async (c) => {
  const body = await c.req.json<{ provider?: LlmProvider; api_key?: string; model?: string }>();
  try {
    const cfg =
      body.api_key && body.provider
        ? { provider: body.provider, apiKey: body.api_key.trim(), model: body.model?.trim() || DEFAULT_MODELS[body.provider] }
        : await getLlmConfig();
    const reply = await generateReply(cfg, "You are a helpful assistant. Reply in a few words only.", "Reply with exactly: connection ok");
    return c.json({ ok: true, reply });
  } catch (e) {
    return c.json({ ok: false, error: String(e) });
  }
});
