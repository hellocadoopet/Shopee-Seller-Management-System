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
    // ponytail: signs the URL as received; if Shopee's registered URL differs (proxy/https rewrite), rebuild it from x-forwarded-* headers.
    const expected = Buffer.from(hmac(shopeeConfig.partnerKey, `${req.url}|${req.body}`), "hex");
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  },

  async handle(body) {
    const { code, shop_id } = JSON.parse(body) as ShopeeWebhookBody;
    // TODO route by code: 3 → refresh orders, 10 → trigger auto-reply rule
    console.log("Shopee webhook:", { code, shop_id });
  },
};
