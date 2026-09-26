/** Shopee mixes units — conversation times are nanoseconds, message and order times seconds. */
export function toMs(ts: number | undefined | null): number | null {
  if (!ts) return null;
  if (ts > 1e17) return Math.floor(ts / 1e6); // ns
  if (ts > 1e11) return ts; // ms
  return ts * 1000; // s
}
