import { Link } from "react-router";
import { MessageCircle, ShoppingBag } from "lucide-react";
import { shopColor, useShopParam, useShops } from "../lib/shops";
import { formatShopName } from "../lib/format";
import { errorText, type ShopError } from "../lib/useFetch";

const PLATFORM_LABEL: Record<string, string> = { shopee: "Shopee", whatsapp: "WhatsApp" };

/** Colour dot + display name + platform cue. `showPlatform` writes the platform as text (chat header). */
export function ShopBadge({ shopId, name, showPlatform }: { shopId: string; name: string; showPlatform?: boolean }) {
  const shops = useShops();
  const platform = shops.find((s) => s.id === shopId)?.platform;
  const label = platform ? (PLATFORM_LABEL[platform] ?? platform) : null;
  const Icon = platform === "whatsapp" ? MessageCircle : platform === "shopee" ? ShoppingBag : null;
  return (
    <span className="inline-flex items-center gap-1.5 text-gray-700 whitespace-nowrap max-w-full min-w-0">
      <span aria-hidden className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: shopColor(shops, shopId) }} />
      <span className="truncate min-w-0">{formatShopName({ platform, shop_name: name })}</span>
      {label &&
        (showPlatform ? (
          <span className="text-xs text-gray-500">· {label}</span>
        ) : (
          <>
            {Icon && <Icon size={12} aria-hidden className="text-gray-500 shrink-0" />}
            <span className="sr-only">({label})</span>
          </>
        ))}
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
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border whitespace-nowrap shrink-0 ${
        shop === id ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
      }`}
    >
      {color && <span aria-hidden className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />}
      {label}
    </button>
  );

  return (
    <div className="flex flex-nowrap overflow-x-auto -mx-4 px-4 pb-1 md:mx-0 md:px-0 md:pb-0 md:flex-wrap gap-2 mb-6">
      {chip("all", "All shops")}
      {shops.map((s) => chip(s.id, formatShopName(s), shopColor(shops, s.id)))}
    </div>
  );
}

/** Per-shop failures (e.g. expired token) — shown above the data that did load. */
export function ShopErrors({ errors }: { errors: ShopError[] | undefined }) {
  const shops = useShops();
  if (!errors?.length) return null;
  return (
    <div className="mb-4 space-y-1">
      {errors.map((e) => {
        const platform = shops.find((s) => s.id === e.shop_id)?.platform;
        return (
          <p key={e.shop_id} role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 break-words">
            <b>{formatShopName({ platform, shop_name: e.shop_name })}</b> couldn't load: {errorText(e.error).slice(0, 160)}
            {/token|auth/i.test(e.error) && (
              <>
                {" "}
                <Link to="/connect" className="underline font-medium">
                  Reconnect
                </Link>
              </>
            )}
          </p>
        );
      })}
    </div>
  );
}

/** Show a Shop column only when more than one shop is in view. */
export function useMultiShop(): boolean {
  const shops = useShops();
  const [shop] = useShopParam();
  return shop === "all" && shops.length > 1;
}
