import Link from "next/link";
import { Package, ShoppingBag, MessageSquare, Tag, Megaphone, BarChart3, Sparkles, Settings } from "lucide-react";
import ShopSwitcher from "@/components/ShopSwitcher";

const tabs = [
  { href: "/dashboard/products", label: "Products", icon: Package },
  { href: "/dashboard/orders", label: "Orders", icon: ShoppingBag },
  { href: "/dashboard/chat", label: "Chat", icon: MessageSquare },
  { href: "/dashboard/vouchers", label: "Vouchers", icon: Tag },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: Sparkles },
  { href: "/dashboard/ads", label: "Ads", icon: Megaphone },
  { href: "/dashboard/insights", label: "Insights", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-5 py-4 border-b">
          <Link href="/dashboard" className="font-bold text-lg text-shopee">
            Shopee Solo
          </Link>
        </div>
        <div className="px-3 py-3 border-b">
          <ShopSwitcher />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {tabs.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-100"
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="px-3 py-3 border-t">
          <Link href="/connect" className="text-sm text-gray-500 hover:text-shopee">
            + Connect another shop
          </Link>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
