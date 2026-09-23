import { supabase } from "./supabase";
import { getFreshAccessToken, type ShopAuth } from "./tokens";

export interface Shop {
  id: string; // our UUID
  shopee_shop_id: number;
  shop_name: string;
}

/** Connected shops, oldest first — stable order so each shop keeps its colour in the UI. */
export async function listShops(): Promise<Shop[]> {
  const { data, error } = await supabase
    .from("shops")
    .select("id, shopee_shop_id, shop_name")
    .is("disconnected_at", null)
    .order("connected_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({ ...s, shop_name: s.shop_name ?? `Shop ${s.shopee_shop_id}` }));
}

/** `?shop=all` (or missing) → every shop; `?shop=<uuid>` → just that one (empty if unknown). */
export async function resolveShops(param: string | undefined): Promise<Shop[]> {
  const shops = await listShops();
  return !param || param === "all" ? shops : shops.filter((s) => s.id === param);
}

export type ShopResult<T> = { shop_id: string; shop_name: string } & ({ ok: true; data: T } | { ok: false; error: string });

/** Run `fn` for every shop in parallel. A failing shop (expired token, Shopee error) never sinks the others. */
export function perShop<T>(shops: Shop[], fn: (shop: Shop, auth: ShopAuth) => Promise<T>): Promise<ShopResult<T>[]> {
  return Promise.all(
    shops.map(async (shop): Promise<ShopResult<T>> => {
      const tag = { shop_id: shop.id, shop_name: shop.shop_name };
      try {
        return { ...tag, ok: true, data: await fn(shop, await getFreshAccessToken(shop.id)) };
      } catch (e) {
        return { ...tag, ok: false, error: String(e) };
      }
    }),
  );
}

/**
 * Flatten per-shop row lists into one list, each row tagged with its shop.
 * Always returns both keys: `items` (rows) and `errors` (one per failed shop).
 */
export function merge<R>(results: ShopResult<R[]>[]) {
  const items: Array<R & { shop_id: string; shop_name: string }> = [];
  const errors: Array<{ shop_id: string; shop_name: string; error: string }> = [];
  for (const r of results) {
    if (r.ok) items.push(...r.data.map((row) => ({ ...row, shop_id: r.shop_id, shop_name: r.shop_name })));
    else errors.push({ shop_id: r.shop_id, shop_name: r.shop_name, error: r.error });
  }
  return { items, errors };
}
