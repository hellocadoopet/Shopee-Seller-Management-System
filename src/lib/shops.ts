import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

export interface Shop {
  id: string;
  platform: string; // "shopee", "whatsapp", …
  external_id: string;
  shop_name: string;
}

// Categorical palette (validated CVD-safe, fixed order). A shop's colour follows the shop —
// assigned by connection order (the API returns oldest first) — never by what's filtered.
// Contrast of some slots is < 3:1, so a dot is always paired with the shop name as text.
const SHOP_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
// ponytail: a 9th shop reuses slot colours; the name label keeps them distinguishable. Revisit past 8 shops.

let cache: Promise<Shop[]> | null = null;
function loadShops(): Promise<Shop[]> {
  cache ??= fetch("/api/shops")
    .then((r) => r.json())
    .then((d: { shops?: Shop[] }) => d.shops ?? [])
    .catch(() => {
      cache = null; // retry on next mount
      return [];
    });
  return cache;
}

export function useShops(): Shop[] {
  const [shops, setShops] = useState<Shop[]>([]);
  useEffect(() => {
    loadShops().then(setShops);
  }, []);
  return shops;
}

export function shopColor(shops: Shop[], shopId: string): string {
  const i = shops.findIndex((s) => s.id === shopId);
  return SHOP_COLORS[(i < 0 ? 0 : i) % SHOP_COLORS.length]!;
}

/** The shop filter lives in the URL (?shop=all|<uuid>), so tabs stay independent and links are shareable. */
export function useShopParam(): [string, (shop: string) => void] {
  const [params, setParams] = useSearchParams();
  const shop = params.get("shop") ?? "all";
  const set = (next: string) =>
    setParams((p) => {
      if (next === "all") p.delete("shop");
      else p.set("shop", next);
      return p;
    });
  return [shop, set];
}
