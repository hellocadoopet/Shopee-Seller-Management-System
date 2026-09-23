import { useEffect, useState } from "react";
import { Link } from "react-router";

type Section<T> = { ok: true; data: T } | { ok: false; error: string };

interface OverviewData {
  today: Section<{ orders: number; revenue: number; currency: string }>;
  chats: Section<{ conversations: number; messages: number }>;
  products: Section<{
    total: number;
    low_stock_threshold: number;
    low_stock: Array<{ item_id: number; item_name: string; stock: number }>;
  }>;
}

function Card({ label, section, value, sub }: {
  label: string;
  section: Section<unknown> | undefined;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="text-sm text-gray-500">{label}</div>
      {!section ? (
        <div className="text-2xl font-semibold mt-1 text-gray-300">…</div>
      ) : section.ok ? (
        <>
          <div className="text-2xl font-semibold mt-1">{value}</div>
          {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
        </>
      ) : (
        <div className="text-sm text-red-600 mt-2 break-words" title={section.error}>
          Couldn't load — {section.error.slice(0, 80)}
        </div>
      )}
    </div>
  );
}

export default function DashboardHome() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/overview")
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  const today = data?.today.ok ? data.today.data : null;
  const chats = data?.chats.ok ? data.chats.data : null;
  const products = data?.products.ok ? data.products.data : null;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Overview</h1>
      {error && <p className="text-red-600 text-sm mb-4">Error: {error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card label="Paid orders today" section={data?.today} value={String(today?.orders ?? 0)} sub="Since 00:00 MY time" />
        <Card
          label="Revenue today"
          section={data?.today}
          value={`${today?.currency ?? "MYR"} ${(today?.revenue ?? 0).toFixed(2)}`}
          sub="Excludes unpaid + cancelled"
        />
        <Card
          label="Unread chats"
          section={data?.chats}
          value={String(chats?.conversations ?? 0)}
          sub={`${chats?.messages ?? 0} unread messages`}
        />
        <Card
          label="Products"
          section={data?.products}
          value={String(products?.total ?? 0)}
          sub={`${products?.low_stock.length ?? 0} low on stock`}
        />
      </div>

      {products && (
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex justify-between items-baseline mb-4">
            <h2 className="font-medium">Low stock (≤ {products.low_stock_threshold} units)</h2>
            <Link to="/dashboard/products" className="text-sm text-shopee hover:underline">
              All products →
            </Link>
          </div>
          {!products.low_stock.length ? (
            <p className="text-sm text-gray-400">Nothing low on stock.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {products.low_stock.map((it) => (
                  <tr key={it.item_id} className="border-t first:border-t-0">
                    <td className="py-2">{it.item_name}</td>
                    <td className={`py-2 text-right font-semibold ${it.stock === 0 ? "text-red-600" : "text-amber-600"}`}>
                      {it.stock} left
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
