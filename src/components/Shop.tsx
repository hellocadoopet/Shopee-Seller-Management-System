import { shopColor, useShopParam, useShops } from "../lib/shops";
import type { ShopError } from "../lib/useFetch";

export function ShopBadge({ shopId, name }: { shopId: string; name: string }) {
  const shops = useShops();
  return (
    <span className="inline-flex items-center gap-1.5 text-gray-700 whitespace-nowrap">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: shopColor(shops, shopId) }} />
      {name}
    </span>
  );
}

/** "All" + one chip per shop. Writes ?shop= in the URL. */
export function ShopFilter() {
  const shops = useShops();
  const [shop, setShop] = useShopParam();
  if (shops.length < 2) return null; // nothing to filter with a single shop

  const chip = (id: string, label: string, color?: string) => (
    <button
      key={id}
      onClick={() => setShop(id)}
      aria-pressed={shop === id}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border ${
        shop === id ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
      }`}
    >
      {color && <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />}
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {chip("all", "All shops")}
      {shops.map((s) => chip(s.id, s.shop_name, shopColor(shops, s.id)))}
    </div>
  );
}

/** Per-shop failures (e.g. expired token) — shown above the data that did load. */
export function ShopErrors({ errors }: { errors: ShopError[] | undefined }) {
  if (!errors?.length) return null;
  return (
    <div className="mb-4 space-y-1">
      {errors.map((e) => (
        <p key={e.shop_id} className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 break-words">
          <b>{e.shop_name}</b> couldn't load — {e.error.slice(0, 160)}
          {/token|auth/i.test(e.error) && " (reconnect this shop)"}
        </p>
      ))}
    </div>
  );
}

/** Show a Shop column only when more than one shop is in view. */
export function useMultiShop(): boolean {
  const shops = useShops();
  const [shop] = useShopParam();
  return shop === "all" && shops.length > 1;
}
