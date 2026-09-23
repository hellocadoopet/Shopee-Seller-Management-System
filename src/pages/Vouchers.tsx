import { useShopParam } from "../lib/shops";
import { useFetch, type ShopList } from "../lib/useFetch";
import { ShopBadge, ShopErrors, useMultiShop } from "../components/Shop";

interface Voucher {
  voucher_id: number;
  voucher_code: string;
  voucher_name: string;
  percentage?: number;
  discount_amount?: number;
  start_time: number;
  end_time: number;
}

export default function VouchersPage() {
  const [shop] = useShopParam();
  const multi = useMultiShop();
  const { data, error, loading } = useFetch<ShopList<Voucher>>(`/api/vouchers?shop=${shop}`);
  const vouchers = data?.items ?? [];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Vouchers</h1>
      <ShopErrors errors={data?.errors} />
      {loading && <p className="text-gray-500">Loading…</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {vouchers.map((v) => (
          <div key={`${v.shop_id}:${v.voucher_id}`} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex justify-between text-xs text-gray-500">
              <span>{v.voucher_code}</span>
              {multi && <ShopBadge shopId={v.shop_id} name={v.shop_name} />}
            </div>
            <div className="text-lg font-medium mt-1">{v.voucher_name}</div>
            <div className="text-2xl font-bold text-shopee mt-2">
              {v.percentage ? `${v.percentage}% off` : `RM ${v.discount_amount} off`}
            </div>
          </div>
        ))}
        {!loading && !vouchers.length && !error && <p className="text-gray-400 text-sm">No vouchers yet.</p>}
      </div>
    </div>
  );
}
