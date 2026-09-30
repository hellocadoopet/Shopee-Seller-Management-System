import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import {
  Package,
  ShoppingBag,
  MessageSquare,
  Tag,
  Megaphone,
  BarChart3,
  Sparkles,
  Settings,
  LayoutDashboard,
  Menu,
  X,
} from "lucide-react";
import LogoutButton from "../components/LogoutButton";
import { ShopFilter } from "../components/Shop";
import { useUnreadChats } from "../lib/unread";

const CHAT = "/dashboard/chat";
const APP = "Shopee Solo";

const tabs = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, end: true },
  { href: CHAT, label: "Chat", icon: MessageSquare },
  { href: "/dashboard/products", label: "Products", icon: Package },
  { href: "/dashboard/orders", label: "Orders", icon: ShoppingBag },
  { href: "/dashboard/vouchers", label: "Vouchers", icon: Tag },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: Sparkles },
  { href: "/dashboard/ads", label: "Ads", icon: Megaphone },
  { href: "/dashboard/insights", label: "Insights", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

function NavItems({ search, unread }: { search: string; unread: number | null }) {
  return (
    <>
      {tabs.map(({ href, label, icon: Icon, end }) => (
        <NavLink
          key={href}
          to={{ pathname: href, search }}
          end={end}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
              isActive ? "bg-shopee-50 text-shopee-700 font-medium" : "text-gray-700 hover:bg-gray-100"
            }`
          }
        >
          <Icon size={18} aria-hidden />
          {label}
          {href === CHAT && !!unread && (
            <span className="ml-auto text-xs font-medium tabular-nums bg-shopee-600 text-white rounded-full px-1.5 min-w-5 text-center">
              {unread > 99 ? "99+" : unread}
              <span className="sr-only"> unread</span>
            </span>
          )}
        </NavLink>
      ))}
    </>
  );
}

function Footer() {
  return (
    <div className="px-3 py-3 border-t border-gray-200 flex items-center justify-between">
      <Link to="/connect" className="text-sm text-gray-500 hover:text-shopee-700">
        + Add shop or number
      </Link>
      <LogoutButton />
    </div>
  );
}

export default function DashboardLayout() {
  const { search, pathname } = useLocation(); // keep ?shop= when switching tabs
  const unread = useUnreadChats();
  const [menuOpen, setMenuOpen] = useState(false);
  const isChat = pathname.startsWith(CHAT);

  // Close the mobile menu on navigation and on Escape.
  useEffect(() => setMenuOpen(false), [pathname, search]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // "(3) Chat · Shopee Solo" — the unread count shows in the browser tab from any page.
  const active = tabs.find((t) => (t.end ? pathname === t.href || pathname === `${t.href}/` : pathname.startsWith(t.href)));
  useEffect(() => {
    document.title = `${unread ? `(${unread}) ` : ""}${active?.label ?? "Dashboard"} · ${APP}`;
  }, [unread, active?.label]);
  useEffect(
    () => () => {
      document.title = APP;
    },
    [],
  );

  const brand = (
    <Link to={{ pathname: "/dashboard", search }} className="font-bold text-lg text-shopee">
      {APP}
    </Link>
  );

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4">
        {brand}
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="btn-icon relative"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
        >
          {menuOpen ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
          {!!unread && !menuOpen && (
            <span aria-hidden className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-shopee-600" />
          )}
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 top-14 bg-black/20 z-20" onClick={() => setMenuOpen(false)} aria-hidden />
            <div id="mobile-nav" className="absolute inset-x-0 top-14 bg-white border-b border-gray-200 shadow-sm z-30">
              <nav aria-label="Main" className="px-3 py-3 space-y-1">
                <NavItems search={search} unread={unread} />
              </nav>
              <Footer />
            </div>
          </>
        )}
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 bg-white border-r border-gray-200 flex-col shrink-0">
        <div className="px-5 py-4 border-b border-gray-200">{brand}</div>
        <nav aria-label="Main" className="flex-1 px-3 py-4 space-y-1">
          <NavItems search={search} unread={unread} />
        </nav>
        <Footer />
      </aside>

      <main
        className={`min-w-0 px-4 py-5 md:p-8 md:flex-1 ${
          // Chat fills exactly the viewport so only its panes scroll. flex-none below md: in the column
          // layout flex-1 would override the height and let the page grow with the thread.
          isChat ? "flex flex-col flex-none h-[calc(100dvh-3.5rem)] md:h-screen overflow-hidden" : "flex-1"
        }`}
      >
        <ShopFilter />
        <Outlet />
      </main>
    </div>
  );
}
