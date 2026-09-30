import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useShopParam } from "../lib/shops";
import { useFetch } from "../lib/useFetch";
import { formatMoney } from "../lib/format";
import { ShopBadge, useMultiShop } from "../components/Shop";
import { PageHeader, RefreshButton } from "../components/Page";
import { ErrorNotice } from "../components/States";

/** null = this shop's platform doesn't have the feature (e.g. a WhatsApp number has no products). */
type Section<T> = { ok: true; data: T } | { ok: false; error: string } | null;

interface ShopOverview {
  shop_id: string;
  shop_name: string;
  today: Section<{ orders: number; revenue: number; currency: string }>;
  chats: Section<{ conversations: number; messages: number }>;
  products: Section<{ total: number; low_stock: Array<{ id: string; name: string; stock: number }> }>;
}

/**
 * Sum a metric over the shops whose section loaded; `failed` counts the ones that didn't,
 * `supported` the ones whose platform has the section at all (0 → the tile is "not available", never "0").
 */
function total<T>(shops: ShopOverview[], pick: (s: ShopOverview) => Section<T>, value: (d: T) => number) {
  let sum = 0, failed = 0, supported = 0;
  for (const s of shops) {
    const sec = pick(s);
    if (!sec) continue;
    supported++;
    if (sec.ok) sum += value(sec.data);
    else failed++;
  }
  // Every shop that has the section failed: there is no true number to show, so no "0" either.
  return { sum, failed, supported, allFailed: supported > 0 && failed === supported };
}

function Tile({
  label,
  value,
  sub,
  failed = 0,
  loading,
  unavailable,
  allFailed,
  href,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  failed?: number;
  loading: boolean;
  unavailable?: boolean;
  allFailed?: boolean;
  href?: { pathname: string; search: string };
  emphasis?: boolean;
}) {
  const body = (
    <>
      <div className="text-sm text-gray-500">{label}</div>
      {loading ? (
        <div aria-hidden className="h-7 w-16 mt-1.5 rounded bg-gray-100 animate-pulse motion-reduce:animate-none" />
      ) : (
        <div
          className={`text-2xl font-semibold mt-1 tabular-nums ${
            unavailable || allFailed ? "text-gray-400" : emphasis ? "text-shopee-700" : ""
          }`}
        >
          {unavailable || allFailed ? "—" : value}
        </div>
      )}
      {!loading &&
        (unavailable ? (
          <div className="text-xs text-gray-500 mt-1">
            Needs a Shopee shop ·{" "}
            <Link className="link" to="/connect">
              Connect
            </Link>
          </div>
        ) : (
          sub && !allFailed && <div className="text-xs text-gray-500 mt-1">{sub}</div>
        ))}
      {!loading && failed > 0 && (
        <div className="text-xs text-red-700 mt-1">
          {failed} shop{failed > 1 ? "s" : ""} couldn't load
        </div>
      )}
    </>
  );
  const cls = `block rounded-xl border p-5 ${emphasis ? "border-shopee-600/40 bg-shopee-50" : "bg-white border-gray-200"}`;
  return href && !unavailable ? (
    <Link to={href} className={`${cls} hover:border-gray-300`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

const cell = <T,>(sec: Section<T>, show: (d: T) => ReactNode) =>
  !sec ? (
    <span className="text-gray-500">—</span>
  ) : sec.ok ? (
    show(sec.data)
  ) : (
    <span className="text-red-700 text-xs" title={sec.error}>
      error
    </span>
  );

export default function OverviewPage() {
  const [shop] = useShopParam();
  const multi = useMultiShop();
  const { search } = useLocation();
  const { data, error, loading, reload } = useFetch<{ low_stock_threshold: number; shops: ShopOverview[] }>(
    `/api/overview?shop=${shop}`,
  );
  const shops = data?.shops ?? [];
  const first = loading && !data;

  const orders = total(shops, (s) => s.today, (d) => d.orders);
  const revenue = total(shops, (s) => s.today, (d) => d.revenue);
  const unread = total(shops, (s) => s.chats, (d) => d.conversations);
  const unreadMsgs = total(shops, (s) => s.chats, (d) => d.messages);
  const products = total(shops, (s) => s.products, (d) => d.total);
  const lowStock = shops.flatMap((s) =>
    s.products?.ok ? s.products.data.low_stock.map((it) => ({ ...it, shop_id: s.shop_id, shop_name: s.shop_name })) : [],
  );
  lowStock.sort((a, b) => a.stock - b.stock);
  const hasUnread = unread.sum > 0;

  return (
    <div>
      <PageHeader title="Overview" actions={<RefreshButton onClick={reload} loading={loading && !!data} />} />
      {error && <ErrorNotice error={error} onRetry={reload} />}

      {/* On a failed first load there's nothing true to show: no tiles rather than fake zeros. */}
      {(data || first) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Tile
            label="Unread chats"
            value={String(unread.sum)}
            sub={
              hasUnread ? (
                <>
                  {unreadMsgs.sum} unread message{unreadMsgs.sum === 1 ? "" : "s"} · <span className="text-shopee-700 font-medium">Open chat →</span>
                </>
              ) : (
                "All caught up"
              )
            }
            failed={unread.failed}
            loading={first}
            unavailable={!first && unread.supported === 0}
            allFailed={!first && unread.allFailed}
            href={{ pathname: "/dashboard/chat", search }}
            emphasis={!first && hasUnread && !unread.allFailed}
          />
          <Tile
            label="Paid orders today"
            value={String(orders.sum)}
            sub="Since 00:00 MY time"
            failed={orders.failed}
            loading={first}
            unavailable={!first && orders.supported === 0}
            allFailed={!first && orders.allFailed}
          />
          <Tile
            label="Revenue today"
            value={formatMoney(revenue.sum)}
            sub="Excludes unpaid + cancelled"
            failed={revenue.failed}
            loading={first}
            unavailable={!first && revenue.supported === 0}
            allFailed={!first && revenue.allFailed}
          />
          <Tile
            label="Products"
            value={String(products.sum)}
            sub={`${lowStock.length} low on stock`}
            failed={products.failed}
            loading={first}
            unavailable={!first && products.supported === 0}
            allFailed={!first && products.allFailed}
          />
        </div>
      )}

      {multi && shops.length > 0 && (
        <section className="panel p-5 mb-6">
          <h2 className="text-base font-medium mb-4">By shop</h2>
          <div className="relative overflow-x-auto -mx-5">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr>
                  <th className="th">Shop</th>
                  <th className="th text-right">Paid orders today</th>
                  <th className="th text-right">Revenue today</th>
                  <th className="th text-right">Unread chats</th>
                  <th className="th text-right">Low stock</th>
                </tr>
              </thead>
              <tbody>
                {shops.map((s) => (
                  <tr key={s.shop_id} className="border-t border-gray-100">
                    <td className="td">
                      <Link to={{ search: `?shop=${s.shop_id}` }} className="hover:underline">
                        <ShopBadge shopId={s.shop_id} name={s.shop_name} />
                      </Link>
                    </td>
                    <td className="td text-right tabular-nums">{cell(s.today, (d) => d.orders)}</td>
                    <td className="td text-right tabular-nums">{cell(s.today, (d) => formatMoney(d.revenue, d.currency))}</td>
                    <td className="td text-right tabular-nums">
                      {cell(s.chats, (d) => (
                        <Link
                          to={{ pathname: "/dashboard/chat", search: `?shop=${s.shop_id}` }}
                          className={d.conversations ? "link font-semibold" : "hover:underline"}
                        >
                          {d.conversations}
                        </Link>
                      ))}
                    </td>
                    <td className="td text-right tabular-nums">{cell(s.products, (d) => d.low_stock.length)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Low stock only when some shop in view has a catalog; otherwise the Products tile already says why. */}
      {data && products.supported > 0 && (
        <section className="panel p-5">
          <div className="flex flex-wrap justify-between items-baseline gap-2 mb-4">
            <h2 className="text-base font-medium">Low stock (≤ {data.low_stock_threshold} units)</h2>
            <Link to={{ pathname: "/dashboard/products", search }} className="text-sm link">
              All products →
            </Link>
          </div>
          {!lowStock.length ? (
            <p className="text-sm text-gray-500">
              {products.allFailed ? "Couldn't check stock." : "Nothing low on stock."}
            </p>
          ) : (
            <div className="relative overflow-x-auto -mx-5">
              <table className="w-full text-sm">
                <tbody>
                  {lowStock.map((it) => (
                    <tr key={`${it.shop_id}:${it.id}`} className="border-t border-gray-100 first:border-t-0">
                      {multi && (
                        <td className="td w-44">
                          <ShopBadge shopId={it.shop_id} name={it.shop_name} />
                        </td>
                      )}
                      <td className="td">{it.name}</td>
                      <td
                        className={`td text-right font-semibold tabular-nums whitespace-nowrap ${
                          it.stock === 0 ? "text-red-700" : "text-amber-700"
                        }`}
                      >
                        {it.stock} left
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
