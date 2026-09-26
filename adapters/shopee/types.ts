// Raw Shopee Open Platform v2 response shapes. Only the adapter sees these — the rest of the
// app gets domain models (adapters/types.ts) via utils/mappers.ts.
// Empty lists come back missing or null (e.g. no `item` key, `voucher_list: null`), so list
// fields are optional and callers must default them.

export interface ShopeeTokenResponse {
  access_token: string;
  refresh_token: string;
  expire_in: number;
}

export interface ShopeeShopInfo {
  shop_name: string;
  region: string;
  status: string;
}

export interface ShopeeItemListEntry {
  item_id: number;
  item_name: string;
  item_sku: string;
  item_status: string;
  has_model: boolean;
  update_time: number;
  create_time: number;
}

export interface ShopeeItemBase {
  item_id: number;
  item_name: string;
  item_sku: string;
  item_status: string;
  has_model: boolean;
  price_info?: Array<{ currency?: string; original_price: number; current_price: number }>;
  stock_info_v2?: { summary_info?: { total_available_stock: number; total_reserved_stock: number } };
}

export interface ShopeeOrderItem {
  item_id: number;
  item_name?: string;
  item_sku?: string;
  model_id?: number;
  model_sku?: string;
  model_quantity_purchased: number;
  model_original_price: number;
  model_discounted_price: number;
}

export interface ShopeeOrderDetail {
  order_sn: string;
  order_status: string;
  total_amount: number;
  currency?: string;
  buyer_user_id?: number;
  buyer_username?: string;
  create_time: number;
  update_time: number;
  item_list?: ShopeeOrderItem[];
}

export interface ShopeeMessage {
  message_id: string;
  from_id: number;
  to_id: number;
  from_shop_id: number; // equals our shop id when the seller sent it
  message_type: string; // "text", "image", "sticker", "item", "order", ...
  content: { text?: string; url?: string; item_id?: number; order_sn?: string };
  created_timestamp: number; // seconds
}

export interface ShopeeConversation {
  conversation_id: string;
  to_id: number;
  to_name?: string;
  unread_count: number;
  latest_message_content?: { text?: string };
  last_message_timestamp?: number; // nanoseconds
}

export interface ShopeeVoucher {
  voucher_id?: number;
  voucher_code?: string;
  voucher_name?: string;
  percentage?: number;
  discount_amount?: number;
  start_time?: number; // seconds
  end_time?: number;
  [key: string]: unknown;
}

export type ShopeeAdRow = Record<string, unknown>;

export interface ShopeeWebhookBody {
  code: number;
  shop_id?: number;
}
