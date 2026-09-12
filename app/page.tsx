import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default async function HomePage() {
  const { data: shops } = await supabase
    .from("shops")
    .select("id, shop_name, shopee_shop_id")
    .is("disconnected_at", null);

  const hasShops = (shops?.length ?? 0) > 0;

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-xl text-center">
        <h1 className="text-4xl font-bold mb-3">Shopee Solo</h1>
        <p className="text-gray-600 mb-8">
          Manage products, orders, chat, vouchers, ads, and insights across all your Shopee shops.
        </p>
        <div className="flex gap-3 justify-center">
          {hasShops && (
            <Link href="/dashboard" className="px-5 py-2.5 rounded-lg bg-shopee text-white font-medium">
              Open dashboard ({shops?.length} shop{shops?.length === 1 ? "" : "s"})
            </Link>
          )}
          <Link
            href="/connect"
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
