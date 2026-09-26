import { useCallback, useEffect, useRef, useState } from "react";

/** GET `url` as JSON; re-fetches when `url` changes. Non-2xx → `error` with the response text. */
export function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<T>;
      })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true; // a newer filter's response wins, not whichever arrives last
    };
  }, [url]);

  useEffect(load, [load]);
  return { data, error, loading, reload: load };
}

/** Call `fn` every `ms` while the tab is visible — how the inbox picks up new messages. */
export function usePoll(fn: () => void, ms: number) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    const id = window.setInterval(() => document.visibilityState === "visible" && latest.current(), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

export type ShopError = { shop_id: string; shop_name: string; error: string };
export type Tagged<T> = T & { shop_id: string; shop_name: string };
export type ShopList<T> = { items: Tagged<T>[]; errors: ShopError[] };
