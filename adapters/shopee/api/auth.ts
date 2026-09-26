import { HOSTS, shopeeConfig } from "../config.js";
import type { ShopeeShopInfo, ShopeeTokenResponse } from "../types.js";
import { hmac, now, signPublic, signShop } from "../utils/signing.js";
import { execute } from "./client.js";

/** The URL a seller visits to authorize the app to their shop. Shopee sends them back to `redirect`. */
export function buildAuthUrl(redirect: string): string {
  const path = "/api/v2/shop/auth_partner";
  const ts = now();
  const sign = hmac(shopeeConfig.partnerKey, `${shopeeConfig.partnerId}${path}${ts}`);
  const qs = new URLSearchParams({
    partner_id: String(shopeeConfig.partnerId),
    timestamp: String(ts),
    sign,
    redirect,
  });
  return `${HOSTS[shopeeConfig.env]}${path}?${qs}`;
}

export function exchangeCodeForToken(code: string, shopId: number) {
  return execute<ShopeeTokenResponse>(signPublic("/api/v2/auth/token/get"), "POST", {
    code,
    shop_id: shopId,
    partner_id: shopeeConfig.partnerId,
  });
}

export function refreshAccessToken(refreshToken: string, shopId: number) {
  return execute<ShopeeTokenResponse>(signPublic("/api/v2/auth/access_token/get"), "POST", {
    refresh_token: refreshToken,
    shop_id: shopId,
    partner_id: shopeeConfig.partnerId,
  });
}

export function getShopInfo(accessToken: string, shopId: number) {
  return execute<ShopeeShopInfo>(signShop("/api/v2/shop/get_shop_info", accessToken, shopId), "GET");
}
