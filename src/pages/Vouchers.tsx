import { useEffect, useState } from "react";

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
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/vouchers")
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((d: { vouchers: Voucher[] }) => setVouchers(d.vouchers))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Vouchers</h1>
      {loading && <p className="text-gray-500">Loading…</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {vouchers.map((v) => (
          <div key={v.voucher_id} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="text-xs text-gray-500">{v.voucher_code}</div>
            <div className="text-lg font-medium mt-1">{v.voucher_name}</div>
            <div className="text-2xl font-bold text-shopee mt-2">
              {v.percentage ? `${v.percentage}% off` : `RM ${v.discount_amount} off`}
            </div>
          </div>
        ))}
        {!loading && !vouchers.length && !error && (
          <p className="text-gray-400 text-sm">No vouchers yet.</p>
        )}
      </div>
    </div>
  );
}
