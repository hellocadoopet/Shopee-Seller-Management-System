import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Turn whatever a failed request threw into one readable line: strips "Error: " prefixes,
 * unwraps a JSON body's `error` field, caps the length. Never shows raw JSON to the user.
 */
export function errorText(raw: unknown): string {
  let s = (raw instanceof Error ? raw.message : String(raw ?? "")).trim();
  while (/^Error:\s*/.test(s)) s = s.replace(/^Error:\s*/, "");
  try {
    const parsed: unknown = JSON.parse(s);
    if (parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string") {
      s = (parsed as { error: string }).error;
    }
  } catch {
    // not JSON: keep the text
  }
  s = s.trim();
  if (!s) return "Something went wrong";
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

/**
 * Read a POST response body that should be JSON without ever surfacing a parser error:
 * a non-JSON body (e.g. a 502 "Bad Gateway" page) becomes a readable Error via errorText.
 */
export async function readJson<T>(r: Response): Promise<T> {
  const text = await r.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(errorText(text || r.statusText));
  }
  if (!r.ok && body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    throw new Error((body as { error: string }).error);
  }
  return body as T;
}

/**
 * GET `url` as JSON; re-fetches when `url` changes. Non-2xx → `error` as readable text (see errorText).
 * `url = null` skips the request (e.g. no shop in view can serve it).
 */
export function useFetch<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(url !== null);

  const load = useCallback(() => {
    if (url === null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<T>;
      })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(errorText(e)))
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
