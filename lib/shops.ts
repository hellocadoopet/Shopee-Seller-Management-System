import { getCapability, isPlatform } from "../adapters/factory.js";
import type { Capability, Credentials, PlatformAdapter, Shop } from "../adapters/types.js";
import { supabase } from "./supabase.js";
import { getCredentials } from "./tokens.js";

/** Connected shops on every platform, oldest first — stable order so each shop keeps its colour in the UI. */
export async function listShops(): Promise<Shop[]> {
  const { data, error } = await supabase
    .from("shops")
    .select("id, platform, external_id, shop_name")
    .is("disconnected_at", null)
    .order("connected_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((s) => isPlatform(s.platform)) // a row for a platform this build doesn't know is ignored, not fatal
    .map((s) => ({ ...s, shop_name: s.shop_name ?? `Shop ${s.external_id}` }));
}

/** `?shop=all` (or missing) → every shop; `?shop=<uuid>` → just that one (empty if unknown). */
export async function resolveShops(param: string | undefined): Promise<Shop[]> {
  const shops = await listShops();
  return !param || param === "all" ? shops : shops.filter((s) => s.id === param);
}

/** The one shop a write targets, or null if the id is missing/unknown. */
export async function findShop(id: string | undefined): Promise<Shop | null> {
  if (!id) return null;
  return (await listShops()).find((s) => s.id === id) ?? null;
}

export type ShopResult<T> = { shop_id: string; shop_name: string } & ({ ok: true; data: T } | { ok: false; error: string });

/**
 * Run `fn` in parallel for every shop whose platform has capability `cap`; shops without it are
 * left out (a WhatsApp number has no products). A failing shop never sinks the others.
 */
export function perShop<K extends Capability, T>(
  shops: Shop[],
  cap: K,
  fn: (impl: NonNullable<PlatformAdapter[K]>, creds: Credentials, shop: Shop) => Promise<T>,
): Promise<ShopResult<T>[]> {
  const able = shops.flatMap((shop) => {
    const impl = getCapability(shop.platform, cap);
    return impl ? [{ shop, impl }] : [];
  });
  return Promise.all(
    able.map(async ({ shop, impl }): Promise<ShopResult<T>> => {
      const tag = { shop_id: shop.id, shop_name: shop.shop_name };
      try {
        return { ...tag, ok: true, data: await fn(impl, await getCredentials(shop), shop) };
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
