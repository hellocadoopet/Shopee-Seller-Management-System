import { useEffect, useState } from "react";
import { useShopParam, useShopsState } from "./shops";

export type Capability = "catalog" | "orders" | "chat" | "promotions" | "ads";

export interface Platform {
  id: string;
  label: string;
  capabilities: string[];
  connect_via: "oauth" | "pairing" | null;
  connectable: boolean;
  missing_config: string[];
}

// Module cache like loadShops: platforms don't change while the app is open.
let cache: Promise<Platform[] | null> | null = null;
function loadPlatforms(): Promise<Platform[] | null> {
  cache ??= fetch("/api/platforms")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((d: { platforms?: Platform[] }) => d.platforms ?? [])
    .catch(() => {
      cache = null; // retry on next mount
      return null;
    });
  return cache;
}

/**
 * "Can any shop in view do X?" — shops in view come from ?shop=, capabilities from /api/platforms.
 * If /api/platforms fails, `supported` is true: fall back to showing the page rather than hiding data.
 */
export function useCapability(cap: Capability): { ready: boolean; supported: boolean; providers: string[] } {
  const { shops, ready: shopsReady } = useShopsState();
  const [shop] = useShopParam();
  const [platforms, setPlatforms] = useState<Platform[] | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    loadPlatforms().then((p) => live && setPlatforms(p));
    return () => {
      live = false;
    };
  }, []);

  if (!shopsReady || platforms === undefined) return { ready: false, supported: false, providers: [] };
  if (platforms === null) return { ready: true, supported: true, providers: ["Shopee"] };

  const withCap = platforms.filter((p) => p.capabilities.includes(cap));
  const inView = shop === "all" ? shops : shops.filter((s) => s.id === shop);
  const supported = inView.some((s) => withCap.some((p) => p.id === s.platform));
  return { ready: true, supported, providers: withCap.map((p) => p.label) };
}
