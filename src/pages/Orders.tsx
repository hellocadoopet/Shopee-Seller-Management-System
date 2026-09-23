import { useShopParam } from "../lib/shops";
import { useFetch, type ShopList } from "../lib/useFetch";
import { ShopBadge, ShopErrors, useMultiShop } from "../components/Shop";

interface Order {
  order_sn: string;
  order_status: string;
  total_amount: number;
  currency: string;
  buyer_username: string;
  create_time: number;
}

export default function OrdersPage() {
  const [shop] = useShopParam();
  const multi = useMultiShop();
  const { data, error, loading } = useFetch<ShopList<Order>>(`/api/orders?days=14&shop=${shop}`);
  const orders = data?.items ?? [];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Orders — last 14 days</h1>
      <ShopErrors errors={data?.errors} />
      {loading && <p className="text-gray-500">Loading from Shopee…</p>}
      {error && <p className="text-red-600 text-sm mb-4">Error: {error}</p>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              {multi && <th className="text-left px-4 py-3">Shop</th>}
              <th className="text-left px-4 py-3">Order #</th>
              <th className="text-left px-4 py-3">Placed</th>
              <th className="text-left px-4 py-3">Buyer</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Amount</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={`${o.shop_id}:${o.order_sn}`} className="border-t border-gray-100">
                {multi && (
                  <td className="px-4 py-3">
                    <ShopBadge shopId={o.shop_id} name={o.shop_name} />
                  </td>
                )}
                <td className="px-4 py-3 font-mono text-xs">{o.order_sn}</td>
                <td className="px-4 py-3 text-gray-500">{new Date(o.create_time * 1000).toLocaleString()}</td>
                <td className="px-4 py-3">{o.buyer_username}</td>
                <td className="px-4 py-3">{o.order_status}</td>
                <td className="px-4 py-3 text-right">
                  {o.currency} {Number(o.total_amount).toFixed(2)}
                </td>
              </tr>
            ))}
            {!loading && !orders.length && !error && (
              <tr>
                <td colSpan={multi ? 6 : 5} className="px-4 py-8 text-center text-gray-400">
                  No orders in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
