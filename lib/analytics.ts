import type { ShopeeOrderDetail } from "./shopee";

export interface BasketPair {
  item_a: number;
  item_b: number;
  support: number;
  confidence: number;
  lift: number;
  co_orders: number;
}

/**
 * Market basket — "buyers who bought X also bought Y".
 * Computed from the orders passed in (fetched live from Shopee).
 */
export function computeBasket(orders: ShopeeOrderDetail[], opts: { minSupport?: number; minCoOrders?: number } = {}) {
  const minSupport = opts.minSupport ?? 0.01;
  const minCoOrders = opts.minCoOrders ?? 5;

  const ordersToItems = new Map<string, Set<number>>();
  for (const o of orders) {
    const items = new Set((o.item_list ?? []).map((it) => it.item_id));
    if (items.size) ordersToItems.set(o.order_sn, items);
  }

  const totalOrders = ordersToItems.size;
  if (!totalOrders) return [];

  const itemCount = new Map<number, number>();
  const pairCount = new Map<string, number>();

  for (const items of ordersToItems.values()) {
    const arr = [...items].sort((a, b) => a - b);
    for (const i of arr) itemCount.set(i, (itemCount.get(i) ?? 0) + 1);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const k = `${arr[i]}_${arr[j]}`;
        pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
      }
    }
  }

  const result: BasketPair[] = [];
  for (const [k, co] of pairCount) {
    if (co < minCoOrders) continue;
    const [a, b] = k.split("_").map(Number) as [number, number];
    const support = co / totalOrders;
    if (support < minSupport) continue;
    const supA = (itemCount.get(a) ?? 0) / totalOrders;
    const supB = (itemCount.get(b) ?? 0) / totalOrders;
    result.push({
      item_a: a,
      item_b: b,
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
