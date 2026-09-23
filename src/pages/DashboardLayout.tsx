import { Link, NavLink, Outlet, useLocation } from "react-router";
import { Package, ShoppingBag, MessageSquare, Tag, Megaphone, BarChart3, Sparkles, Settings, LayoutDashboard } from "lucide-react";
import LogoutButton from "../components/LogoutButton";
import { ShopFilter } from "../components/Shop";

const tabs = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, end: true },
  { href: "/dashboard/chat", label: "Chat", icon: MessageSquare },
  { href: "/dashboard/products", label: "Products", icon: Package },
  { href: "/dashboard/orders", label: "Orders", icon: ShoppingBag },
  { href: "/dashboard/vouchers", label: "Vouchers", icon: Tag },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: Sparkles },
  { href: "/dashboard/ads", label: "Ads", icon: Megaphone },
  { href: "/dashboard/insights", label: "Insights", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout() {
  const { search } = useLocation(); // keep ?shop= when switching tabs

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="px-5 py-4 border-b">
          <Link to={{ pathname: "/dashboard", search }} className="font-bold text-lg text-shopee">
            Shopee Solo
          </Link>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {tabs.map(({ href, label, icon: Icon, end }) => (
            <NavLink
              key={href}
              to={{ pathname: href, search }}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
                  isActive ? "bg-gray-100 text-gray-900 font-medium" : "text-gray-700 hover:bg-gray-100"
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-3 border-t flex items-center justify-between">
          <Link to="/connect" className="text-sm text-gray-500 hover:text-shopee">
            + Connect another shop
          </Link>
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 p-8 min-w-0">
        <ShopFilter />
        <Outlet />
      </main>
    </div>
  );
}
