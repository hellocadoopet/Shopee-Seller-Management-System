import crypto from "node:crypto";
import { HOSTS, shopeeConfig } from "../config.js";

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function hmac(key: string, base: string): string {
  return crypto.createHmac("sha256", key.trim()).update(base).digest("hex");
}

function toQuery(p: Record<string, string | number>): string {
  return new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString();
}

const host = () => HOSTS[shopeeConfig.env];

/** Partner-level call (auth, public endpoints): sign = HMAC(partner_id + path + timestamp). */
export function signPublic(path: string, extra: Record<string, string | number> = {}): SignedRequest {
  const ts = now();
  const sign = hmac(shopeeConfig.partnerKey, `${shopeeConfig.partnerId}${path}${ts}`);
  const qs = toQuery({ partner_id: shopeeConfig.partnerId, timestamp: ts, sign, ...extra });
  return { url: `${host()}${path}?${qs}`, headers: { "Content-Type": "application/json" } };
}

/** Shop-level call: sign = HMAC(partner_id + path + timestamp + access_token + shop_id). */
export function signShop(
  path: string,
  accessToken: string,
  shopId: number,
  extra: Record<string, string | number> = {},
): SignedRequest {
  const ts = now();
  const sign = hmac(shopeeConfig.partnerKey, `${shopeeConfig.partnerId}${path}${ts}${accessToken}${shopId}`);
  const qs = toQuery({
    partner_id: shopeeConfig.partnerId,
    timestamp: ts,
    access_token: accessToken,
    shop_id: shopId,
    sign,
    ...extra,
  });
  return { url: `${host()}${path}?${qs}`, headers: { "Content-Type": "application/json" } };
}
