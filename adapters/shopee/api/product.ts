import type { ShopeeItemBase, ShopeeItemListEntry } from "../types.js";
import { signShop } from "../utils/signing.js";
import { execute } from "./client.js";

export function getItemList(accessToken: string, shopId: number, offset = 0, pageSize = 50) {
  return execute<{ item?: ShopeeItemListEntry[]; total_count: number; has_next_page: boolean }>(
    signShop("/api/v2/product/get_item_list", accessToken, shopId, {
      offset,
      page_size: pageSize,
      item_status: "NORMAL",
    }),
    "GET",
  );
}

/** Names, prices and stock for up to 50 items at a time. */
export function getItemBaseInfo(accessToken: string, shopId: number, itemIds: number[]) {
  return execute<{ item_list?: ShopeeItemBase[] }>(
    signShop("/api/v2/product/get_item_base_info", accessToken, shopId, { item_id_list: itemIds.join(",") }),
    "GET",
  );
}

export function updateItemPrice(
  accessToken: string,
  shopId: number,
  itemId: number,
  priceList: Array<{ model_id?: number; original_price: number }>,
) {
  return execute(signShop("/api/v2/product/update_price", accessToken, shopId), "POST", {
    item_id: itemId,
    price_list: priceList,
  });
}
