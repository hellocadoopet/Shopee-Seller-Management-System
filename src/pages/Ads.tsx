import { Megaphone } from "lucide-react";
import { useShopParam } from "../lib/shops";
import { useCapability } from "../lib/capabilities";
import { useFetch, type ShopList } from "../lib/useFetch";
import { formatMoney, formatNumber, formatPercent, formatRatio } from "../lib/format";
import { ShopBadge, ShopErrors, useMultiShop } from "../components/Shop";
import { PageHeader, RefreshButton } from "../components/Page";
import { EmptyState, ErrorNotice, Loading, NeedsCapability } from "../components/States";

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
  const cap = useCapability("ads");
  const { data, error, loading, reload } = useFetch<ShopList<Report>>(
    cap.ready && cap.supported ? `/api/ads?shop=${shop}` : null,
  );
  const reports = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Ads"
        subtitle="Last 30 days · read-only (edit campaigns on the platform)"
        actions={cap.supported && <RefreshButton onClick={reload} loading={loading && !!data} />}
      />
      {!cap.ready ? (
        <Loading />
      ) : !cap.supported ? (
        <NeedsCapability what="Ads" providers={cap.providers} />
      ) : (
        <>
          <ShopErrors errors={data?.errors} />
          {error && <ErrorNotice error={error} onRetry={reload} />}
          {loading && !data ? (
            <Loading />
          ) : data && !reports.length ? (
            <EmptyState icon={Megaphone} title="No ad campaigns in the last 30 days" />
          ) : data ? (
            <div className="panel relative overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-gray-50">
                  <tr>
                    {multi && <th className="th">Shop</th>}
                    <th className="th">Campaign</th>
                    <th className="th text-right">Impressions</th>
                    <th className="th text-right">Clicks</th>
                    <th className="th text-right">CTR</th>
                    <th className="th text-right">Spend</th>
                    <th className="th text-right">GMV</th>
                    <th className="th text-right">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={`${r.shop_id}:${r.campaign_id}`} className="border-t border-gray-100">
                      {multi && (
                        <td className="td">
                          <ShopBadge shopId={r.shop_id} name={r.shop_name} />
                        </td>
                      )}
                      <td className="td font-medium">{r.campaign_name}</td>
                      <td className="td text-right tabular-nums">{formatNumber(r.impressions)}</td>
                      <td className="td text-right tabular-nums">{formatNumber(r.clicks)}</td>
                      <td className="td text-right tabular-nums">{formatPercent(r.ctr)}</td>
                      <td className="td text-right tabular-nums whitespace-nowrap">{formatMoney(r.spend)}</td>
                      <td className="td text-right tabular-nums whitespace-nowrap">{formatMoney(r.gmv)}</td>
                      <td className="td text-right tabular-nums font-semibold">{formatRatio(r.roas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
