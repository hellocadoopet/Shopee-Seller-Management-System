"use client";
import { useEffect, useState } from "react";

interface Shop {
  id: string;
  shopee_shop_id: number;
  shop_name: string | null;
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[2]!) : null;
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export default function ShopSwitcher() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/shops")
      .then((r) => r.json())
      .then((d: { shops: Shop[] }) => {
        setShops(d.shops);
        setCurrent(readCookie("current_shop_id") ?? d.shops[0]?.id ?? null);
      });
  }, []);

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    writeCookie("current_shop_id", id);
    setCurrent(id);
    window.location.reload(); // re-fetch all tab data for the new shop
  }

  if (!shops.length) return null;

  return (
    <select
      value={current ?? ""}
      onChange={onChange}
      className="text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white"
    >
      {shops.map((s) => (
        <option key={s.id} value={s.id}>
          {s.shop_name ?? `Shop ${s.shopee_shop_id}`}
        </option>
      ))}
    </select>
  );
}
