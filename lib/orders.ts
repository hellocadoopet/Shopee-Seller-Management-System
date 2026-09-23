import { getFreshAccessToken } from "./tokens";
import { getOrderList, getOrderDetail, type ShopeeOrderDetail } from "./shopee";

// Shopee's get_order_list only accepts a time window of at most 15 days.
const MAX_WINDOW_SECONDS = 15 * 86400;

/**
 * Fetch full order details for the last `daysBack` days, live from Shopee (nothing is stored).
 *
 * Handles the two Shopee quirks that the naive version got wrong:
 *   1. Time window capped at 15 days  → we walk the range in 15-day chunks.
 *   2. Order list is paginated (100/page) → we follow the cursor until `more` is false.
 */
export async function fetchOrders(shopUuid: string, daysBack: number): Promise<ShopeeOrderDetail[]> {
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

  return orders;
}
