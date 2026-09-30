import { Tag } from "lucide-react";
import { useShopParam } from "../lib/shops";
import { useCapability } from "../lib/capabilities";
import { useFetch, type ShopList } from "../lib/useFetch";
import { formatMoney, formatShortDate } from "../lib/format";
import { ShopBadge, ShopErrors, useMultiShop } from "../components/Shop";
import { PageHeader, RefreshButton } from "../components/Page";
import { EmptyState, ErrorNotice, Loading, NeedsCapability } from "../components/States";

interface Voucher {
  id: string;
  code: string;
  name: string;
  percentage: number | null;
  amount: number | null;
  starts_at: number; // epoch ms
  ends_at: number;
}

function discount(v: Voucher): string {
  if (v.percentage) return `${v.percentage}% off`;
  if (v.amount != null) return `${formatMoney(v.amount)} off`;
  return "Discount";
}

function phase(v: Voucher, now: number): { label: string; className: string } {
  if (v.starts_at && now < v.starts_at) return { label: "Upcoming", className: "bg-gray-100 text-gray-700" };
  if (v.ends_at && now > v.ends_at) return { label: "Ended", className: "bg-gray-100 text-gray-700" };
  return { label: "Active", className: "bg-green-50 text-green-700" };
}

export default function VouchersPage() {
  const [shop] = useShopParam();
  const multi = useMultiShop();
  const cap = useCapability("promotions");
  const { data, error, loading, reload } = useFetch<ShopList<Voucher>>(
    cap.ready && cap.supported ? `/api/vouchers?shop=${shop}` : null,
  );
  const vouchers = data?.items ?? [];
  const now = Date.now();

  return (
    <div>
      <PageHeader title="Vouchers" actions={cap.supported && <RefreshButton onClick={reload} loading={loading && !!data} />} />
      {!cap.ready ? (
        <Loading />
      ) : !cap.supported ? (
        <NeedsCapability what="Vouchers" providers={cap.providers} />
      ) : (
        <>
          <ShopErrors errors={data?.errors} />
          {error && <ErrorNotice error={error} onRetry={reload} />}
          {loading && !data ? (
            <Loading />
          ) : data && !vouchers.length ? (
            <EmptyState icon={Tag} title="No vouchers" body="The shops in view have no vouchers." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {vouchers.map((v) => {
                const p = phase(v, now);
                return (
                  <div key={`${v.shop_id}:${v.id}`} className="panel p-5 min-w-0">
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="font-mono text-gray-500 truncate">{v.code}</span>
                      {multi && <ShopBadge shopId={v.shop_id} name={v.shop_name} />}
                    </div>
                    <div className="text-lg font-medium mt-1 break-words">{v.name}</div>
                    <div className="text-2xl font-semibold text-shopee-600 mt-2 tabular-nums">{discount(v)}</div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 mt-2">
                      <span className={`px-2 py-0.5 rounded-full ${p.className}`}>{p.label}</span>
                      <span>
                        {formatShortDate(v.starts_at)} – {formatShortDate(v.ends_at)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
