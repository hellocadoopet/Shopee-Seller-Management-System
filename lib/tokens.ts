import { supabase } from "./supabase";
import { encrypt, decrypt } from "./crypto";
import { refreshAccessToken } from "./shopee";

export interface ShopAuth {
  shopUuid: string;
  shopeeShopId: number;
  accessToken: string;
}

/** Persist newly-issued tokens for a shop. */
export async function saveTokens(
  shopUuid: string,
  accessToken: string,
  refreshToken: string,
  expireInSeconds: number,
) {
  await supabase.from("shop_tokens").upsert({
    shop_id: shopUuid,
    access_token_enc: encrypt(accessToken),
    refresh_token_enc: encrypt(refreshToken),
    access_expires_at: new Date(Date.now() + expireInSeconds * 1000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
}

/**
 * Return an access token for the given shop. If it's about to expire (<10 min),
 * refreshes automatically. Solo system, single user — no fancy locking needed.
 */
export async function getFreshAccessToken(shopUuid: string): Promise<ShopAuth> {
  const { data: shop, error: shopErr } = await supabase
    .from("shops")
    .select("id, shopee_shop_id")
    .eq("id", shopUuid)
    .single();
  if (shopErr || !shop) throw new Error(`shop ${shopUuid} not found`);

  const { data: tok, error: tokErr } = await supabase
    .from("shop_tokens")
    .select("access_token_enc, refresh_token_enc, access_expires_at")
    .eq("shop_id", shopUuid)
    .single();
  if (tokErr || !tok) throw new Error(`tokens for shop ${shopUuid} not found`);

  const aboutToExpire = new Date(tok.access_expires_at).getTime() - Date.now() < 10 * 60 * 1000;
  if (aboutToExpire) {
    const refresh = decrypt(tok.refresh_token_enc);
    const fresh = await refreshAccessToken(refresh, shop.shopee_shop_id);
    await saveTokens(shopUuid, fresh.access_token, fresh.refresh_token, fresh.expire_in);
    return { shopUuid, shopeeShopId: shop.shopee_shop_id, accessToken: fresh.access_token };
  }

  return {
    shopUuid,
    shopeeShopId: shop.shopee_shop_id,
    accessToken: decrypt(tok.access_token_enc),
  };
}
