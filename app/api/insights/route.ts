import { NextRequest, NextResponse } from "next/server";
import { getCurrentShopId } from "@/lib/currentShop";
import { supabase } from "@/lib/supabase";
import { computeBasket, orderSizeBucket } from "@/lib/analytics";

/**
 * Returns several insights in one response: sales by product, basket pairs,
 * order-size distribution.
 *
 * Recomputed on-demand from cached order data. For a solo shop, this is fine.
 */
export async function GET(req: NextRequest) {
  const shopId = await getCurrentShopId();
  if (!shopId) return NextResponse.json({ error: "no shop connected" }, { status: 400 });

  const days = Number(new URL(req.url).searchParams.get("days") ?? 30);
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  // Sales by product
  const { data: items } = await supabase
    .from("shopee_order_items")
    .select("item_id, item_name, qty, discounted_price")
    .eq("shop_id", shopId);

  const byProduct = new Map<number, { item_name: string; qty: number; revenue: number }>();
  for (const it of items ?? []) {
    const entry = byProduct.get(it.item_id) ?? { item_name: it.item_name ?? `#${it.item_id}`, qty: 0, revenue: 0 };
    entry.qty += it.qty;
    entry.revenue += Number(it.discounted_price) * it.qty;
    byProduct.set(it.item_id, entry);
  }
  const sales = [...byProduct.entries()]
    .map(([item_id, v]) => ({ item_id, ...v, revenue: round(v.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);

  // Order-size distribution
  const { data: orders } = await supabase
    .from("shopee_orders")
    .select("total_amount")
    .eq("shop_id", shopId)
    .gte("created_at_shopee", since);

  const buckets = new Map<string, { orders: number; revenue: number }>();
  for (const o of orders ?? []) {
    const b = orderSizeBucket(Number(o.total_amount));
    const e = buckets.get(b) ?? { orders: 0, revenue: 0 };
    e.orders++;
    e.revenue += Number(o.total_amount);
    buckets.set(b, e);
  }
  const sizes = [...buckets.entries()].map(([bucket, v]) => ({ bucket, ...v, revenue: round(v.revenue) }));

  // Basket pairs
  const basket = (await computeBasket(shopId)).slice(0, 50);

  return NextResponse.json({ sales, sizes, basket });
}

function round(x: number) {
  return Math.round(x * 100) / 100;
}
