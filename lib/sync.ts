import { supabase } from "./supabase";
import { getFreshAccessToken } from "./tokens";
import { getOrderList, getOrderDetail, type ShopeeOrderDetail } from "./shopee";

// Shopee's get_order_list only accepts a time window of at most 15 days.
const MAX_WINDOW_SECONDS = 15 * 86400;

/**
 * Fetch orders for the last `daysBack` days from Shopee and persist them to
 * the database (shopee_orders + shopee_order_items). Returns the order details.
 *
 * Handles the two Shopee quirks that the naive version got wrong:
 *   1. Time window capped at 15 days  → we walk the range in 15-day chunks.
 *   2. Order list is paginated (100/page) → we follow the cursor until `more` is false.
 *
 * Persisting is what makes the Insights and Overview tabs work — they read
 * from these tables, not from Shopee directly.
 */
export async function syncOrders(shopUuid: string, daysBack: number): Promise<ShopeeOrderDetail[]> {
  const auth = await getFreshAccessToken(shopUuid);
  const now = Math.floor(Date.now() / 1000);
  const start = now - daysBack * 86400;

  // 1. Collect all order numbers, chunking by 15-day windows + following cursor
  const orderSns: string[] = [];
  for (let from = start; from < now; from += MAX_WINDOW_SECONDS) {
    const to = Math.min(from + MAX_WINDOW_SECONDS, now);
    let cursor = "";
    do {
      const list = await getOrderList(auth.accessToken, auth.shopeeShopId, from, to, cursor);
      orderSns.push(...list.order_list.map((o) => o.order_sn));
      cursor = list.more && list.next_cursor ? list.next_cursor : "";
    } while (cursor);
  }

  if (!orderSns.length) return [];

  // 2. Fetch full details in batches of 50 (Shopee's max per call)
  const orders: ShopeeOrderDetail[] = [];
  for (let i = 0; i < orderSns.length; i += 50) {
    const chunk = orderSns.slice(i, i + 50);
    const detail = await getOrderDetail(auth.accessToken, auth.shopeeShopId, chunk);
    orders.push(...detail.order_list);
  }

  // 3. Persist orders (one batched upsert)
  const orderRows = orders.map((o) => ({
    shop_id: shopUuid,
    order_sn: o.order_sn,
    order_status: o.order_status,
    total_amount: o.total_amount,
    currency: o.currency ?? "MYR",
    buyer_user_id: o.buyer_user_id ?? null,
    buyer_username: o.buyer_username ?? null,
    created_at_shopee: new Date(o.create_time * 1000).toISOString(),
    updated_at_shopee: new Date(o.update_time * 1000).toISOString(),
    raw: o,
  }));
  for (let i = 0; i < orderRows.length; i += 500) {
    await supabase.from("shopee_orders").upsert(orderRows.slice(i, i + 500));
  }

  // 4. Persist order items (batched)
  const itemRows = orders.flatMap((o) =>
    (o.item_list ?? []).map((it) => ({
      shop_id: shopUuid,
      order_sn: o.order_sn,
      item_id: it.item_id,
      model_id: it.model_id ?? 0,
      item_name: it.item_name ?? null,
      item_sku: it.item_sku ?? null,
      model_sku: it.model_sku ?? null,
      qty: it.model_quantity_purchased,
      unit_price: it.model_original_price,
      discounted_price: it.model_discounted_price,
    })),
  );
  for (let i = 0; i < itemRows.length; i += 500) {
    await supabase.from("shopee_order_items").upsert(itemRows.slice(i, i + 500));
  }

  return orders;
}
