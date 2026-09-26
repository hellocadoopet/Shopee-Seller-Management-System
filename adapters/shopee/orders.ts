import type { OrdersCapability } from "../types.js";
import { getOrderDetail, getOrderList } from "./api/index.js";
import type { ShopeeOrderDetail } from "./types.js";
import { toOrder } from "./utils/mappers.js";

// get_order_list only accepts a time window of at most 15 days.
const MAX_WINDOW_SECONDS = 15 * 86400;

export const orders: OrdersCapability = {
  /**
   * Full details of orders created from `since` until now. Handles two Shopee quirks:
   *   1. Time window capped at 15 days  → walk the range in 15-day chunks.
   *   2. Order list paginated (100/page) → follow the cursor until `more` is false.
   */
  async list({ accessToken, externalId }, since) {
    const shopId = Number(externalId);
    const now = Math.floor(Date.now() / 1000);

    const orderSns: string[] = [];
    for (let from = Math.floor(since.getTime() / 1000); from < now; from += MAX_WINDOW_SECONDS) {
      const to = Math.min(from + MAX_WINDOW_SECONDS, now);
      let cursor = "";
      do {
        const list = await getOrderList(accessToken, shopId, from, to, cursor);
        orderSns.push(...(list.order_list ?? []).map((o) => o.order_sn));
        cursor = list.more && list.next_cursor ? list.next_cursor : "";
      } while (cursor);
    }

    // Full details in batches of 50 (Shopee's max per call)
    const details: ShopeeOrderDetail[] = [];
    for (let i = 0; i < orderSns.length; i += 50) {
      const r = await getOrderDetail(accessToken, shopId, orderSns.slice(i, i + 50));
      details.push(...(r.order_list ?? []));
    }
    return details.map(toOrder);
  },
};
