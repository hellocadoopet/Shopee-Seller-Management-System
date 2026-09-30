import { useShopsState } from "../lib/shops";
import { Link } from "react-router";

export default function HomePage() {
  const { shops, ready } = useShopsState();
  const shopCount = shops.length;
  const hasShops = shopCount > 0;

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl sm:text-4xl font-bold mb-3">Shopee Solo</h1>
        <p className="text-gray-600 mb-8">
          Products, orders, vouchers, ads and customer chats for your Shopee shops and WhatsApp numbers, in one place.
        </p>
        {/* Buttons wait for /api/shops so returning users don't see "Connect your first shop" flash as primary. */}
        {ready && (
          <div className="flex flex-wrap gap-3 justify-center">
            {hasShops && (
              <Link to="/dashboard" className="btn-primary px-5 py-2.5">
                Open dashboard ({shopCount} shop{shopCount === 1 ? "" : "s"})
              </Link>
            )}
            <Link to="/connect" className={`${hasShops ? "btn-secondary" : "btn-primary"} px-5 py-2.5`}>
              {hasShops ? "Add a shop or number" : "Connect your first shop"}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
