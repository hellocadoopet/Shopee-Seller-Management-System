import { useShopParam } from "../lib/shops";
import { useFetch, type ShopError, type Tagged } from "../lib/useFetch";
import { ShopBadge, ShopErrors, useMultiShop } from "../components/Shop";

type SalesRow = Tagged<{ item_id: number; item_name: string; qty: number; revenue: number }>;
interface SizeBucket { bucket: string; orders: number; revenue: number }
type BasketPair = Tagged<{ item_a: number; item_b: number; co_orders: number; confidence: number; lift: number }>;
type ShopTotal = Tagged<{ orders: number; revenue: number }>;

export default function InsightsPage() {
  const [shop] = useShopParam();
  const multi = useMultiShop();
  const { data, error, loading } = useFetch<{
    by_shop: ShopTotal[]; sales: SalesRow[]; sizes: SizeBucket[]; basket: BasketPair[]; errors: ShopError[];
  }>(`/api/insights?shop=${shop}`);
  const sales = data?.sales ?? [], sizes = data?.sizes ?? [], basket = data?.basket ?? [], byShop = data?.by_shop ?? [];

  if (loading) return <p className="text-gray-500">Computing insights…</p>;
  if (error) return <p className="text-red-600 text-sm">{error}</p>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Insights — last 30 days</h1>
      <ShopErrors errors={data?.errors} />

      {multi && byShop.length > 1 && (
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-medium mb-4">By shop (paid orders)</h2>
          <table className="w-full text-sm">
            <thead className="text-gray-600">
              <tr><th className="text-left py-2">Shop</th><th className="text-right py-2">Orders</th><th className="text-right py-2">Revenue</th></tr>
            </thead>
            <tbody>
              {byShop.map((s) => (
                <tr key={s.shop_id} className="border-t">
                  <td className="py-2"><ShopBadge shopId={s.shop_id} name={s.shop_name} /></td>
                  <td className="text-right">{s.orders}</td>
                  <td className="text-right">RM {s.revenue.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-medium mb-4">Sales by product</h2>
        {!sales.length ? (
          <p className="text-sm text-gray-400">No orders in the last 30 days.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-gray-600">
              <tr>{multi && <th className="text-left py-2">Shop</th>}<th className="text-left py-2">Product</th><th className="text-right py-2">Qty</th><th className="text-right py-2">Revenue</th></tr>
            </thead>
            <tbody>
              {sales.slice(0, 20).map((r) => (
                <tr key={`${r.shop_id}:${r.item_id}`} className="border-t">
                  {multi && <td className="py-2"><ShopBadge shopId={r.shop_id} name={r.shop_name} /></td>}
                  <td className="py-2">{r.item_name}</td>
                  <td className="text-right">{r.qty}</td>
                  <td className="text-right">RM {r.revenue.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-medium mb-4">Basket pairs (buyers who bought X also bought Y)</h2>
        {!basket.length ? (
          <p className="text-sm text-gray-400">Not enough data — need at least 5 co-orders per pair.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-gray-600">
              <tr>
                {multi && <th className="text-left py-2">Shop</th>}
                <th className="text-left py-2">Pair</th>
                <th className="text-right py-2">Co-orders</th>
                <th className="text-right py-2">Confidence</th>
                <th className="text-right py-2">Lift</th>
              </tr>
            </thead>
            <tbody>
              {basket.map((p) => (
                <tr key={`${p.shop_id}:${p.item_a}-${p.item_b}`} className="border-t">
                  {multi && <td className="py-2"><ShopBadge shopId={p.shop_id} name={p.shop_name} /></td>}
                  <td className="py-2 font-mono text-xs">#{p.item_a} + #{p.item_b}</td>
                  <td className="text-right">{p.co_orders}</td>
                  <td className="text-right">{(p.confidence * 100).toFixed(0)}%</td>
                  <td className="text-right font-semibold">{p.lift.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-medium mb-4">Order size distribution</h2>
        {!sizes.length ? (
          <p className="text-sm text-gray-400">No orders yet.</p>
        ) : (
          <div className="space-y-2">
            {sizes.map((b) => {
              const max = Math.max(...sizes.map((s) => s.orders));
              const pct = max ? (b.orders / max) * 100 : 0;
              return (
                <div key={b.bucket} className="flex items-center gap-3">
                  <div className="w-20 text-sm text-gray-600">RM {b.bucket}</div>
                  <div className="flex-1 bg-gray-100 h-6 rounded overflow-hidden">
                    <div className="bg-shopee h-full" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-40 text-sm text-right">
                    {b.orders} orders · RM {b.revenue.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
