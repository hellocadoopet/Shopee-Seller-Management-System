import { getAdapter } from "../adapters/factory.js";
import type { Credentials, IssuedTokens, Shop } from "../adapters/types.js";
import { decrypt, encrypt } from "./crypto.js";
import { supabase } from "./supabase.js";

// Refresh this long before the access token actually expires.
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

const inSeconds = (s: number | undefined) => (s == null ? null : new Date(Date.now() + s * 1000).toISOString());

/** Persist newly issued tokens for a shop, encrypted. */
export async function saveTokens(shopUuid: string, tokens: IssuedTokens) {
  const { error } = await supabase.from("shop_tokens").upsert({
    shop_id: shopUuid,
    access_token_enc: encrypt(tokens.accessToken),
    refresh_token_enc: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
    access_expires_at: inSeconds(tokens.expiresIn),
    refresh_expires_at: inSeconds(tokens.refreshExpiresIn),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`saving tokens: ${error.message}`);
}

/**
 * Credentials for calling the shop's platform. If the access token is about to expire and the
 * platform can refresh, it's refreshed (and the rotated tokens saved) first.
 * Solo system, single user — no locking around concurrent refreshes.
 */
export async function getCredentials(shop: Shop): Promise<Credentials> {
  const { data: tok, error } = await supabase
    .from("shop_tokens")
    .select("access_token_enc, refresh_token_enc, access_expires_at")
    .eq("shop_id", shop.id)
    .single();
  if (error || !tok) throw new Error(`tokens for shop ${shop.id} not found`);

  const refresh = getAdapter(shop.platform).connect?.refresh;
  const expiring = tok.access_expires_at && new Date(tok.access_expires_at).getTime() - Date.now() < REFRESH_MARGIN_MS;
  if (expiring && refresh && tok.refresh_token_enc) {
    const fresh = await refresh(decrypt(tok.refresh_token_enc), shop.external_id);
    await saveTokens(shop.id, fresh);
    return { externalId: shop.external_id, accessToken: fresh.accessToken };
  }
  return { externalId: shop.external_id, accessToken: decrypt(tok.access_token_enc) };
}
