import { useEffect, useState } from "react";

interface Order {
  order_sn: string;
  order_status: string;
  total_amount: number;
  currency: string;
  buyer_username: string;
  create_time: number;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/orders?days=14")
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((d: { orders: Order[] }) => setOrders(d.orders))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Orders — last 14 days</h1>

      {loading && <p className="text-gray-500">Loading from Shopee…</p>}
      {error && <p className="text-red-600 text-sm mb-4">Error: {error}</p>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-4 py-3">Order #</th>
              <th className="text-left px-4 py-3">Buyer</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Amount</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.order_sn} className="border-t border-gray-100">
                <td className="px-4 py-3 font-mono text-xs">{o.order_sn}</td>
                <td className="px-4 py-3">{o.buyer_username}</td>
                <td className="px-4 py-3">{o.order_status}</td>
                <td className="px-4 py-3 text-right">
                  {o.currency} {Number(o.total_amount).toFixed(2)}
                </td>
              </tr>
            ))}
            {!loading && !orders.length && !error && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
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
