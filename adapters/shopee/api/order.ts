import type { ShopeeOrderDetail } from "../types.js";
import { signShop } from "../utils/signing.js";
import { execute } from "./client.js";

export function getOrderList(accessToken: string, shopId: number, timeFrom: number, timeTo: number, cursor = "") {
  return execute<{ order_list?: Array<{ order_sn: string }>; next_cursor: string; more: boolean }>(
    signShop("/api/v2/order/get_order_list", accessToken, shopId, {
      time_range_field: "create_time",
      time_from: timeFrom,
      time_to: timeTo,
      page_size: 100,
      cursor,
    }),
    "GET",
  );
}

export function getOrderDetail(accessToken: string, shopId: number, orderSnList: string[]) {
  return execute<{ order_list?: ShopeeOrderDetail[] }>(
    signShop("/api/v2/order/get_order_detail", accessToken, shopId, {
      order_sn_list: orderSnList.join(","),
      response_optional_fields: "buyer_user_id,buyer_username,item_list,total_amount,order_status,create_time,update_time",
    }),
    "GET",
  );
}
