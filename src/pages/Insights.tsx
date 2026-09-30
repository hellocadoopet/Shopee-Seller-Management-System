import { BarChart3 } from "lucide-react";
import { useShopParam } from "../lib/shops";
import { useCapability } from "../lib/capabilities";
import { useFetch, type ShopError, type Tagged } from "../lib/useFetch";
import { formatMoney, formatNumber } from "../lib/format";
import { ShopBadge, ShopErrors, useMultiShop } from "../components/Shop";
import { PageHeader, RefreshButton } from "../components/Page";
import { EmptyState, ErrorNotice, Loading, NeedsCapability } from "../components/States";

type SalesRow = Tagged<{ product_id: string; name: string; qty: number; revenue: number }>;
interface SizeBucket { bucket: string; orders: number; revenue: number }
type BasketPair = Tagged<{ product_a: string; product_b: string; co_orders: number; confidence: number; lift: number }>;
type ShopTotal = Tagged<{ orders: number; revenue: number }>;

export default function InsightsPage() {
  const [shop] = useShopParam();
  const multi = useMultiShop();
  const cap = useCapability("orders");
  const { data, error, loading, reload } = useFetch<{
    by_shop: ShopTotal[]; sales: SalesRow[]; sizes: SizeBucket[]; basket: BasketPair[]; errors: ShopError[];
  }>(cap.ready && cap.supported ? `/api/insights?shop=${shop}` : null);
  const sales = data?.sales ?? [], sizes = data?.sizes ?? [], basket = data?.basket ?? [], byShop = data?.by_shop ?? [];

  // Basket pairs come as product ids; the names are in the same response's sales rows.
  const names = new Map(sales.map((r) => [`${r.shop_id}:${r.product_id}`, r.name]));
  const productName = (shopId: string, id: string) => {
    const n = names.get(`${shopId}:${id}`);
    return n ?? <span className="font-mono text-xs">#{id}</span>;
  };
  const maxOrders = Math.max(0, ...sizes.map((s) => s.orders));

  return (
    <div>
      <PageHeader
        title="Insights"
        subtitle="Last 30 days · paid orders"
        actions={cap.supported && <RefreshButton onClick={reload} loading={loading && !!data} />}
      />
      {!cap.ready ? (
        <Loading />
      ) : !cap.supported ? (
        <NeedsCapability what="Insights" providers={cap.providers} />
      ) : (
        <>
          <ShopErrors errors={data?.errors} />
          {error && <ErrorNotice error={error} onRetry={reload} />}
          {loading && !data ? (
            <Loading label="Crunching the last 30 days…" />
          ) : data && !sales.length ? (
            <EmptyState icon={BarChart3} title="No paid orders in the last 30 days" />
          ) : data ? (
            <div className="space-y-6">
              {multi && byShop.length > 1 && (
                <section className="panel p-5">
                  <h2 className="text-base font-medium mb-4">By shop (paid orders)</h2>
                  <div className="relative overflow-x-auto -mx-5">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th className="th">Shop</th>
                          <th className="th text-right">Orders</th>
                          <th className="th text-right">Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byShop.map((s) => (
                          <tr key={s.shop_id} className="border-t border-gray-100">
                            <td className="td"><ShopBadge shopId={s.shop_id} name={s.shop_name} /></td>
                            <td className="td text-right tabular-nums">{formatNumber(s.orders)}</td>
                            <td className="td text-right tabular-nums whitespace-nowrap">{formatMoney(s.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <section className="panel p-5">
                <h2 className="text-base font-medium mb-4">Sales by product</h2>
                <div className="relative overflow-x-auto -mx-5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        {multi && <th className="th">Shop</th>}
                        <th className="th">Product</th>
                        <th className="th text-right">Qty</th>
                        <th className="th text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sales.slice(0, 20).map((r) => (
                        <tr key={`${r.shop_id}:${r.product_id}`} className="border-t border-gray-100">
                          {multi && <td className="td"><ShopBadge shopId={r.shop_id} name={r.shop_name} /></td>}
                          <td className="td">{r.name}</td>
                          <td className="td text-right tabular-nums">{formatNumber(r.qty)}</td>
                          <td className="td text-right tabular-nums whitespace-nowrap">{formatMoney(r.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel p-5">
                <h2 className="text-base font-medium mb-4">Basket pairs (buyers who bought X also bought Y)</h2>
                {!basket.length ? (
                  <p className="text-sm text-gray-500">Not enough data yet: a pair needs at least 5 orders containing both.</p>
                ) : (
                  <div className="relative overflow-x-auto -mx-5">
                    <table className="w-full text-sm min-w-[560px]">
                      <thead>
                        <tr>
                          {multi && <th className="th">Shop</th>}
                          <th className="th">Pair</th>
                          <th className="th text-right">Co-orders</th>
                          <th className="th text-right">Confidence</th>
                          <th className="th text-right">Lift</th>
                        </tr>
                      </thead>
                      <tbody>
                        {basket.map((p) => (
                          <tr key={`${p.shop_id}:${p.product_a}-${p.product_b}`} className="border-t border-gray-100">
                            {multi && <td className="td"><ShopBadge shopId={p.shop_id} name={p.shop_name} /></td>}
                            <td className="td">
                              {productName(p.shop_id, p.product_a)} + {productName(p.shop_id, p.product_b)}
                            </td>
                            <td className="td text-right tabular-nums">{p.co_orders}</td>
                            <td className="td text-right tabular-nums">{(p.confidence * 100).toFixed(0)}%</td>
                            <td className="td text-right tabular-nums font-semibold">{p.lift.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="panel p-5">
                <h2 className="text-base font-medium mb-4">Order size distribution</h2>
                {!sizes.length ? (
                  <p className="text-sm text-gray-500">No orders yet.</p>
                ) : (
                  <div className="space-y-3 sm:space-y-2">
                    {sizes.map((b) => {
                      const pct = maxOrders ? (b.orders / maxOrders) * 100 : 0;
                      return (
                        <div key={b.bucket} className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1">
                          <div className="w-24 text-sm text-gray-500 shrink-0">RM {b.bucket}</div>
                          <div className="flex-1 min-w-[8rem] bg-gray-100 h-6 rounded overflow-hidden">
                            <div className="bg-shopee h-full" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="w-full sm:w-52 text-sm text-right tabular-nums text-gray-700">
                            {formatNumber(b.orders)} orders · {formatMoney(b.revenue)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
