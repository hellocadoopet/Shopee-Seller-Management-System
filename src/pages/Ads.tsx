import { useShopParam } from "../lib/shops";
import { useFetch, type ShopList } from "../lib/useFetch";
import { ShopBadge, ShopErrors, useMultiShop } from "../components/Shop";

interface Report {
  campaign_id: string;
  campaign_name: string;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  spend: number | null;
  gmv: number | null;
  roas: number | null;
}

export default function AdsPage() {
  const [shop] = useShopParam();
  const multi = useMultiShop();
  const { data, error, loading } = useFetch<ShopList<Report>>(`/api/ads?shop=${shop}`);
  const reports = data?.items ?? [];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Ads — last 30 days</h1>
      {loading && <p className="text-gray-500">Loading…</p>}
      <ShopErrors errors={data?.errors} />
      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              {multi && <th className="text-left px-4 py-3">Shop</th>}
              <th className="text-left px-4 py-3">Campaign</th>
              <th className="text-right px-4 py-3">Impr.</th>
              <th className="text-right px-4 py-3">Clicks</th>
              <th className="text-right px-4 py-3">CTR</th>
              <th className="text-right px-4 py-3">Spend</th>
              <th className="text-right px-4 py-3">GMV</th>
              <th className="text-right px-4 py-3">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={`${r.shop_id}:${r.campaign_id}`} className="border-t border-gray-100">
                {multi && (
                  <td className="px-4 py-3">
                    <ShopBadge shopId={r.shop_id} name={r.shop_name} />
                  </td>
                )}
                <td className="px-4 py-3 font-medium">{r.campaign_name}</td>
                <td className="px-4 py-3 text-right">{r.impressions ?? "—"}</td>
                <td className="px-4 py-3 text-right">{r.clicks ?? "—"}</td>
                <td className="px-4 py-3 text-right">{r.ctr?.toFixed(2)}%</td>
                <td className="px-4 py-3 text-right">RM {r.spend?.toFixed(2)}</td>
                <td className="px-4 py-3 text-right">RM {r.gmv?.toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-semibold">{r.roas?.toFixed(2)}x</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-4">
        Read-only. Edit campaigns on the platform — its API doesn't expose ad editing.
      </p>
    </div>
  );
}
