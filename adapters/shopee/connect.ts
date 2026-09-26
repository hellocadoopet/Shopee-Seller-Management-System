import type { ConnectCapability, IssuedTokens } from "../types.js";
import { shopeeConfig } from "./config.js";
import { buildAuthUrl, exchangeCodeForToken, getShopInfo, refreshAccessToken } from "./api/index.js";
import type { ShopeeTokenResponse } from "./types.js";

// Shopee refresh tokens last 30 days, and each refresh issues a new one.
const REFRESH_TTL_SECONDS = 30 * 24 * 3600;

const toTokens = (t: ShopeeTokenResponse): IssuedTokens => ({
  accessToken: t.access_token,
  expiresIn: t.expire_in,
  refreshToken: t.refresh_token,
  refreshExpiresIn: REFRESH_TTL_SECONDS,
});

export const connect: ConnectCapability = {
  authorizeUrl(state) {
    const redirect = new URL(shopeeConfig.redirectUrl);
    redirect.searchParams.set("state", state);
    return buildAuthUrl(redirect.toString());
  },

  /** Shopee's redirect carries code + shop_id. A Main Account login sends main_account_id instead — not handled yet. */
  async completeAuthorization(query) {
    const { code, shop_id } = query;
    if (!code || !shop_id) throw new Error("Missing code or shop_id from Shopee redirect.");
    const shopId = Number(shop_id);

    const tokens = await exchangeCodeForToken(code, shopId);
    let name: string | null = null;
    try {
      name = (await getShopInfo(tokens.access_token, shopId)).shop_name;
    } catch {
      // Non-fatal — the shop still connects; the name falls back to its id.
    }
    return { externalId: shop_id, name, tokens: toTokens(tokens) };
  },

  async refresh(refreshToken, externalId) {
    return toTokens(await refreshAccessToken(refreshToken, Number(externalId)));
  },
};
