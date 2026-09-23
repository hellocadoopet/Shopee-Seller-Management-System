import { useEffect, useState } from "react";
import { Link } from "react-router";

export default function HomePage() {
  const [shopCount, setShopCount] = useState(0);

  useEffect(() => {
    fetch("/api/shops")
      .then((r) => r.json())
      .then((d: { shops?: unknown[] }) => setShopCount(d.shops?.length ?? 0))
      .catch(() => {});
  }, []);

  const hasShops = shopCount > 0;

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-xl text-center">
        <h1 className="text-4xl font-bold mb-3">Shopee Solo</h1>
        <p className="text-gray-600 mb-8">
          Manage products, orders, chat, vouchers, ads, and insights across all your Shopee shops.
        </p>
        <div className="flex gap-3 justify-center">
          {hasShops && (
            <Link to="/dashboard" className="px-5 py-2.5 rounded-lg bg-shopee text-white font-medium">
              Open dashboard ({shopCount} shop{shopCount === 1 ? "" : "s"})
            </Link>
          )}
          <Link
            to="/connect"
            className={`px-5 py-2.5 rounded-lg border border-gray-300 hover:bg-gray-100 ${
              hasShops ? "" : "bg-shopee text-white border-shopee hover:opacity-90"
            }`}
          >
            {hasShops ? "Connect another shop" : "Connect your first shop"}
          </Link>
        </div>
      </div>
    </main>
  );
}
