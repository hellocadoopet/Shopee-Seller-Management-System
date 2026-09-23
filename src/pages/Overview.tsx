import { Link, useLocation } from "react-router";
import { useShopParam } from "../lib/shops";
import { useFetch } from "../lib/useFetch";
import { ShopBadge, useMultiShop } from "../components/Shop";

type Section<T> = { ok: true; data: T } | { ok: false; error: string };

interface ShopOverview {
  shop_id: string;
  shop_name: string;
  today: Section<{ orders: number; revenue: number; currency: string }>;
  chats: Section<{ conversations: number; messages: number }>;
  products: Section<{ total: number; low_stock: Array<{ item_id: number; item_name: string; stock: number }> }>;
}

/** Sum a metric over the shops whose section loaded; `failed` counts the ones that didn't. */
function total<T>(shops: ShopOverview[], pick: (s: ShopOverview) => Section<T>, value: (d: T) => number) {
  let sum = 0, failed = 0;
  for (const s of shops) {
    const sec = pick(s);
    if (sec.ok) sum += value(sec.data);
    else failed++;
  }
  return { sum, failed };
}

function Tile({ label, value, sub, failed, loading }: { label: string; value: string; sub?: string; failed: number; loading: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${loading ? "text-gray-300" : ""}`}>{loading ? "…" : value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
      {failed > 0 && <div className="text-xs text-red-600 mt-1">{failed} shop{failed > 1 ? "s" : ""} couldn't load</div>}
    </div>
  );
}

const cell = <T,>(sec: Section<T>, show: (d: T) => React.ReactNode) =>
  sec.ok ? show(sec.data) : <span className="text-red-600 text-xs" title={sec.error}>error</span>;

export default function OverviewPage() {
  const [shop] = useShopParam();
  const multi = useMultiShop();
  const { search } = useLocation();
  const { data, error, loading } = useFetch<{ low_stock_threshold: number; shops: ShopOverview[] }>(`/api/overview?shop=${shop}`);
  const shops = data?.shops ?? [];

  const orders = total(shops, (s) => s.today, (d) => d.orders);
  const revenue = total(shops, (s) => s.today, (d) => d.revenue);
  const unread = total(shops, (s) => s.chats, (d) => d.conversations);
  const unreadMsgs = total(shops, (s) => s.chats, (d) => d.messages);
  const products = total(shops, (s) => s.products, (d) => d.total);
  const lowStock = shops.flatMap((s) =>
    s.products.ok ? s.products.data.low_stock.map((it) => ({ ...it, shop_id: s.shop_id, shop_name: s.shop_name })) : [],
  );
  lowStock.sort((a, b) => a.stock - b.stock);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Overview</h1>
      {error && <p className="text-red-600 text-sm mb-4">Error: {error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Tile label="Paid orders today" value={String(orders.sum)} sub="Since 00:00 MY time" failed={orders.failed} loading={loading && !data} />
        <Tile label="Revenue today" value={`MYR ${revenue.sum.toFixed(2)}`} sub="Excludes unpaid + cancelled" failed={revenue.failed} loading={loading && !data} />
        <Tile label="Unread chats" value={String(unread.sum)} sub={`${unreadMsgs.sum} unread messages`} failed={unread.failed} loading={loading && !data} />
        <Tile label="Products" value={String(products.sum)} sub={`${lowStock.length} low on stock`} failed={products.failed} loading={loading && !data} />
      </div>

      {multi && shops.length > 0 && (
        <section className="bg-white rounded-xl border border-gray-200 p-5 mb-8">
          <h2 className="font-medium mb-4">By shop</h2>
          <table className="w-full text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="text-left py-2">Shop</th>
                <th className="text-right py-2">Paid orders today</th>
                <th className="text-right py-2">Revenue today</th>
                <th className="text-right py-2">Unread chats</th>
                <th className="text-right py-2">Low stock</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((s) => (
                <tr key={s.shop_id} className="border-t">
                  <td className="py-2">
                    <Link to={{ search: `?shop=${s.shop_id}` }} className="hover:underline">
                      <ShopBadge shopId={s.shop_id} name={s.shop_name} />
                    </Link>
                  </td>
                  <td className="text-right">{cell(s.today, (d) => d.orders)}</td>
                  <td className="text-right">{cell(s.today, (d) => `MYR ${d.revenue.toFixed(2)}`)}</td>
                  <td className="text-right">
                    {cell(s.chats, (d) => (
                      <Link to={{ pathname: "/dashboard/chat", search: `?shop=${s.shop_id}` }} className={d.conversations ? "text-shopee font-semibold hover:underline" : ""}>
                        {d.conversations}
                      </Link>
                    ))}
                  </td>
                  <td className="text-right">{cell(s.products, (d) => d.low_stock.length)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data && (
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex justify-between items-baseline mb-4">
            <h2 className="font-medium">Low stock (≤ {data.low_stock_threshold} units)</h2>
            <Link to={{ pathname: "/dashboard/products", search }} className="text-sm text-shopee hover:underline">
              All products →
            </Link>
          </div>
          {!lowStock.length ? (
            <p className="text-sm text-gray-400">Nothing low on stock.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {lowStock.map((it) => (
                  <tr key={`${it.shop_id}:${it.item_id}`} className="border-t first:border-t-0">
                    {multi && (
                      <td className="py-2 w-44">
                        <ShopBadge shopId={it.shop_id} name={it.shop_name} />
                      </td>
                    )}
                    <td className="py-2">{it.item_name}</td>
                    <td className={`py-2 text-right font-semibold ${it.stock === 0 ? "text-red-600" : "text-amber-600"}`}>{it.stock} left</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
