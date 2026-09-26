import type { Order } from "../adapters/types.js";

export interface BasketPair {
  product_a: string;
  product_b: string;
  support: number;
  confidence: number;
  lift: number;
  co_orders: number;
}

/**
 * Market basket — "buyers who bought X also bought Y" — over the orders passed in.
 * Product ids are only unique within a shop, so call this once per shop.
 */
export function computeBasket(orders: Order[], opts: { minSupport?: number; minCoOrders?: number } = {}) {
  const minSupport = opts.minSupport ?? 0.01;
  const minCoOrders = opts.minCoOrders ?? 5;

  const baskets = orders.map((o) => new Set(o.lines.map((l) => l.product_id))).filter((s) => s.size);
  const totalOrders = baskets.length;
  if (!totalOrders) return [];

  const itemCount = new Map<string, number>();
  const pairCount = new Map<string, { a: string; b: string; n: number }>();

  for (const items of baskets) {
    const arr = [...items].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    for (const i of arr) itemCount.set(i, (itemCount.get(i) ?? 0) + 1);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const [a, b] = [arr[i]!, arr[j]!];
        const key = JSON.stringify([a, b]);
        const p = pairCount.get(key) ?? { a, b, n: 0 };
        p.n++;
        pairCount.set(key, p);
      }
    }
  }

  const result: BasketPair[] = [];
  for (const { a, b, n: co } of pairCount.values()) {
    if (co < minCoOrders) continue;
    const support = co / totalOrders;
    if (support < minSupport) continue;
    const supA = (itemCount.get(a) ?? 0) / totalOrders;
    const supB = (itemCount.get(b) ?? 0) / totalOrders;
    result.push({
      product_a: a,
      product_b: b,
      support: round(support),
      confidence: round(co / (itemCount.get(a) ?? 1)),
      lift: supA && supB ? round(support / (supA * supB)) : 0,
      co_orders: co,
    });
  }
  return result.sort((a, b) => b.lift - a.lift);
}

export function orderSizeBucket(amount: number): string {
  if (amount < 25) return "0-25";
  if (amount < 50) return "25-50";
  if (amount < 100) return "50-100";
  if (amount < 250) return "100-250";
  return "250+";
}

function round(x: number) {
  return Math.round(x * 1_000_000) / 1_000_000;
}
