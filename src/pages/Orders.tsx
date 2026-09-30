import { ShoppingBag } from "lucide-react";
import { useShopParam } from "../lib/shops";
import { useCapability } from "../lib/capabilities";
import { useFetch, type ShopList } from "../lib/useFetch";
import { formatDateTime, formatMoney, statusTone } from "../lib/format";
import { ShopBadge, ShopErrors, useMultiShop } from "../components/Shop";
import { PageHeader, RefreshButton } from "../components/Page";
import { EmptyState, ErrorNotice, Loading, NeedsCapability } from "../components/States";

interface Order {
  id: string;
  status: string;
  total: number;
  currency: string;
  buyer_name: string | null;
  created_at: number; // epoch ms
}

const DAYS = 14;

export default function OrdersPage() {
  const [shop] = useShopParam();
  const multi = useMultiShop();
  const cap = useCapability("orders");
  const { data, error, loading, reload } = useFetch<ShopList<Order>>(
    cap.ready && cap.supported ? `/api/orders?days=${DAYS}&shop=${shop}` : null,
  );
  const orders = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle={`Last ${DAYS} days`}
        actions={cap.supported && <RefreshButton onClick={reload} loading={loading && !!data} />}
      />
      {!cap.ready ? (
        <Loading />
      ) : !cap.supported ? (
        <NeedsCapability what="Orders" providers={cap.providers} />
      ) : (
        <>
          <ShopErrors errors={data?.errors} />
          {error && <ErrorNotice error={error} onRetry={reload} />}
          {loading && !data ? (
            <Loading />
          ) : data && !orders.length ? (
            <EmptyState icon={ShoppingBag} title={`No orders in the last ${DAYS} days`} />
          ) : data ? (
            <div className="panel relative overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-gray-50">
                  <tr>
                    {multi && <th className="th">Shop</th>}
                    <th className="th">Order #</th>
                    <th className="th">Placed</th>
                    <th className="th">Buyer</th>
                    <th className="th">Status</th>
                    <th className="th text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const tone = statusTone(o.status);
                    return (
                      <tr key={`${o.shop_id}:${o.id}`} className="border-t border-gray-100">
                        {multi && (
                          <td className="td">
                            <ShopBadge shopId={o.shop_id} name={o.shop_name} />
                          </td>
                        )}
                        <td className="td font-mono text-xs">{o.id}</td>
                        <td className="td text-gray-500 whitespace-nowrap">{formatDateTime(o.created_at)}</td>
                        <td className="td">{o.buyer_name ?? "—"}</td>
                        <td className="td">
                          <span className={`px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${tone.className}`}>{tone.label}</span>
                        </td>
                        <td className="td text-right tabular-nums whitespace-nowrap">{formatMoney(o.total, o.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
