import crypto from "node:crypto";
import { config } from "./config";

// Shopee Open Platform v2 hosts (Southeast Asia region — Malaysia/Singapore/etc.)
const HOSTS = {
  live: "https://openplatform.shopeemobile.com",
  sandbox: "https://openplatform.sandbox.test-stable.shopee.sg",
} as const;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function hmac(key: string, base: string): string {
  return crypto.createHmac("sha256", key.trim()).update(base).digest("hex");
}

function toQuery(p: Record<string, string | number>): string {
  return new URLSearchParams(
    Object.entries(p).map(([k, v]) => [k, String(v)]),
  ).toString();
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signPublic(path: string, extra: Record<string, string | number> = {}): SignedRequest {
  const ts = now();
  const base = `${config.shopee.partnerId}${path}${ts}`;
  const sign = hmac(config.shopee.partnerKey, base);
  const qs = toQuery({ partner_id: config.shopee.partnerId, timestamp: ts, sign, ...extra });
  return { url: `${HOSTS[config.shopee.env]}${path}?${qs}`, headers: { "Content-Type": "application/json" } };
}

function signShop(
  path: string,
  accessToken: string,
  shopId: number,
  extra: Record<string, string | number> = {},
): SignedRequest {
  const ts = now();
  const base = `${config.shopee.partnerId}${path}${ts}${accessToken}${shopId}`;
  const sign = hmac(config.shopee.partnerKey, base);
  const qs = toQuery({
    partner_id: config.shopee.partnerId,
    timestamp: ts,
    access_token: accessToken,
    shop_id: shopId,
    sign,
    ...extra,
  });
  return { url: `${HOSTS[config.shopee.env]}${path}?${qs}`, headers: { "Content-Type": "application/json" } };
}

export class ShopeeApiError extends Error {
  constructor(public error: string, public requestId: string, msg: string) {
    super(`[${error}] ${msg} (req=${requestId})`);
    this.name = "ShopeeApiError";
  }
  isAuthError() {
    return ["error_auth", "error_token_expired", "error_invalid_access_token"].includes(this.error);
  }
}

async function execute<T>(req: SignedRequest, method: "GET" | "POST", body?: unknown): Promise<T> {
  const res = await fetch(req.url, {
    method,
    headers: req.headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json()) as { error?: string; message?: string; request_id?: string } & T;
  if (data.error && data.error !== "") {
    throw new ShopeeApiError(data.error, data.request_id ?? "", data.message ?? "Shopee API error");
  }
  return data;
}

/** Build the URL a seller visits to authorize your app to their shop. */
export function buildAuthUrl(): string {
  const path = "/api/v2/shop/auth_partner";
  const ts = now();
  const base = `${config.shopee.partnerId}${path}${ts}`;
  const sign = hmac(config.shopee.partnerKey, base);
  const qs = toQuery({
    partner_id: config.shopee.partnerId,
    timestamp: ts,
    sign,
    redirect: config.shopee.redirectUrl,
  });
  return `${HOSTS[config.shopee.env]}${path}?${qs}`;
}

// ─────────────────────────────────────────────────────────────
// API methods (keep this list small — add more as needed)
// ─────────────────────────────────────────────────────────────

export async function exchangeCodeForToken(code: string, shopId: number) {
  return execute<{ access_token: string; refresh_token: string; expire_in: number }>(
    signPublic("/api/v2/auth/token/get"),
    "POST",
    { code, shop_id: shopId, partner_id: config.shopee.partnerId },
  );
}

export async function refreshAccessToken(refreshToken: string, shopId: number) {
  return execute<{ access_token: string; refresh_token: string; expire_in: number }>(
    signPublic("/api/v2/auth/access_token/get"),
    "POST",
    { refresh_token: refreshToken, shop_id: shopId, partner_id: config.shopee.partnerId },
  );
}

export async function getShopInfo(accessToken: string, shopId: number) {
  return execute<{ shop_name: string; region: string; status: string }>(
    signShop("/api/v2/shop/get_shop_info", accessToken, shopId),
    "GET",
  );
}

export async function getItemList(accessToken: string, shopId: number, offset = 0, pageSize = 50) {
  return execute<{
    item: Array<{
      item_id: number;
      item_name: string;
      item_sku: string;
      item_status: string;
      has_model: boolean;
      update_time: number;
      create_time: number;
    }>;
    total_count: number;
    has_next_page: boolean;
  }>(
    signShop("/api/v2/product/get_item_list", accessToken, shopId, {
      offset,
      page_size: pageSize,
      item_status: "NORMAL",
    }),
    "GET",
  );
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

/** Fetch names, prices and stock for up to 50 items at a time. */
export async function getItemBaseInfo(accessToken: string, shopId: number, itemIds: number[]) {
  return execute<{ item_list: ShopeeItemBase[] }>(
    signShop("/api/v2/product/get_item_base_info", accessToken, shopId, {
      item_id_list: itemIds.join(","),
    }),
    "GET",
  );
}

export async function updateItemPrice(
  accessToken: string,
  shopId: number,
  itemId: number,
  priceList: Array<{ model_id?: number; original_price: number }>,
) {
  return execute(
    signShop("/api/v2/product/update_price", accessToken, shopId),
    "POST",
    { item_id: itemId, price_list: priceList },
  );
}

export async function getOrderList(
  accessToken: string,
  shopId: number,
  timeFrom: number,
  timeTo: number,
  cursor = "",
) {
  return execute<{ order_list: Array<{ order_sn: string }>; next_cursor: string; more: boolean }>(
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

export async function getOrderDetail(accessToken: string, shopId: number, orderSnList: string[]) {
  return execute<{ order_list: ShopeeOrderDetail[] }>(
    signShop("/api/v2/order/get_order_detail", accessToken, shopId, {
      order_sn_list: orderSnList.join(","),
      response_optional_fields:
        "buyer_user_id,buyer_username,item_list,total_amount,order_status,create_time,update_time",
    }),
    "GET",
  );
}

export async function getMessageList(
  accessToken: string,
  shopId: number,
  conversationId: string,
  offset = "",
) {
  return execute<{ messages: Array<Record<string, unknown>>; page_result: { next_offset: string; more: boolean } }>(
    signShop("/api/v2/sellerchat/get_message", accessToken, shopId, {
      conversation_id: conversationId,
      offset,
      page_size: 50,
    }),
    "GET",
  );
}

export async function sendMessage(accessToken: string, shopId: number, toBuyerId: number, text: string) {
  return execute(
    signShop("/api/v2/sellerchat/send_message", accessToken, shopId),
    "POST",
    { to_id: toBuyerId, message_type: "text", content: { text } },
  );
}

export async function getVoucherList(accessToken: string, shopId: number, status = "all") {
  return execute<{ voucher_list: Array<Record<string, unknown>> }>(
    signShop("/api/v2/voucher/get_voucher_list", accessToken, shopId, {
      status,
      page_no: 1,
      page_size: 50,
    }),
    "GET",
  );
}

export async function getAdsPerformance(
  accessToken: string,
  shopId: number,
  startDate: string,
  endDate: string,
) {
  return execute<{ report_list: Array<Record<string, unknown>> }>(
    signShop("/api/v2/ads/get_total_balance", accessToken, shopId, {
      start_date: startDate,
      end_date: endDate,
    }),
    "GET",
  );
}

export async function getShopeeIpRanges() {
  return execute<{ ip_list: string[] }>(signPublic("/api/v2/public/get_shopee_ip_ranges"), "GET");
}
