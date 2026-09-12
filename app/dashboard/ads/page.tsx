"use client";
import { useEffect, useState } from "react";

interface Report {
  campaign_id: number;
  campaign_name: string;
  impression: number;
  clicks: number;
  ctr: number;
  expense: number;
  gmv: number;
  roi: number;
}

export default function AdsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ads")
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((d: { reports?: Report[] }) => setReports(d.reports ?? []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Ads — last 30 days</h1>
      {loading && <p className="text-gray-500">Loading…</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
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
              <tr key={r.campaign_id} className="border-t border-gray-100">
                <td className="px-4 py-3 font-medium">{r.campaign_name}</td>
                <td className="px-4 py-3 text-right">{r.impression}</td>
                <td className="px-4 py-3 text-right">{r.clicks}</td>
                <td className="px-4 py-3 text-right">{r.ctr?.toFixed(2)}%</td>
                <td className="px-4 py-3 text-right">RM {r.expense?.toFixed(2)}</td>
                <td className="px-4 py-3 text-right">RM {r.gmv?.toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-semibold">{r.roi?.toFixed(2)}x</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-4">
        Read-only. Edit campaigns in Seller Center — Shopee API doesn't expose ad editing.
      </p>
    </div>
  );
}
