import crypto from "node:crypto";
import type { WebhookCapability } from "../types.js";
import { shopeeConfig } from "./config.js";
import type { ShopeeWebhookBody } from "./types.js";
import { hmac } from "./utils/signing.js";

/**
 * Shopee push notifications. Signature = HMAC-SHA256(partner_key, "<url>|<raw body>") in the
 * Authorization header. Common codes: 1=shop_authorization, 3=order_status, 10=new_message, 12=item_promotion
 */
export const webhook: WebhookCapability = {
  verify(req) {
    const sig = req.header("authorization");
    if (!sig) return false;
    // Shopee signs the public URL it posted to (the Vercel domain), but the API sees its own Railway
    // host behind the Vercel rewrite, so rebuild the URL on the public origin (same as the redirect's).
    const received = new URL(req.url);
    const origin = shopeeConfig.redirectUrl ? new URL(shopeeConfig.redirectUrl).origin : received.origin;
    const url = origin + received.pathname + received.search;
    const expected = Buffer.from(hmac(shopeeConfig.partnerKey, `${url}|${req.body}`), "hex");
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  },

  async handle(body) {
    const { code, shop_id } = JSON.parse(body) as ShopeeWebhookBody;
    // TODO route by code: 3 → refresh orders, 10 → trigger auto-reply rule
    console.log("Shopee webhook:", { code, shop_id });
  },
};
