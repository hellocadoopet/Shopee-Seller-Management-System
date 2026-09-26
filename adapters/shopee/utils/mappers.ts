import type { AdReport, Conversation, Message, Order, Product, Voucher } from "../../types.js";
import type {
  ShopeeAdRow,
  ShopeeConversation,
  ShopeeItemBase,
  ShopeeMessage,
  ShopeeOrderDetail,
  ShopeeVoucher,
} from "../types.js";
import { toMs } from "./time.js";

// Orders that don't count as sales: not paid yet, or being cancelled.
const NOT_SALES = new Set(["UNPAID", "IN_CANCEL", "CANCELLED"]);

export function toProduct(b: ShopeeItemBase): Product {
  return {
    id: String(b.item_id),
    name: b.item_name,
    sku: b.item_sku,
    status: b.item_status,
    has_variants: b.has_model,
    price: b.price_info?.[0]?.current_price ?? null,
    stock: b.stock_info_v2?.summary_info?.total_available_stock ?? null,
  };
}

export function toOrder(o: ShopeeOrderDetail): Order {
  return {
    id: o.order_sn,
    status: o.order_status,
    counts_as_sale: !NOT_SALES.has(o.order_status),
    total: Number(o.total_amount),
    currency: o.currency ?? "MYR",
    buyer_name: o.buyer_username ?? null,
    created_at: toMs(o.create_time) ?? 0,
    lines: (o.item_list ?? []).map((it) => ({
      product_id: String(it.item_id),
      name: it.item_name ?? `#${it.item_id}`,
      qty: it.model_quantity_purchased,
      unit_price: Number(it.model_discounted_price),
    })),
  };
}

export function toConversation(c: ShopeeConversation): Conversation {
  return {
    id: c.conversation_id,
    peer_id: String(c.to_id),
    peer_name: c.to_name ?? null,
    unread: c.unread_count ?? 0,
    last_text: c.latest_message_content?.text ?? null,
    last_at: toMs(c.last_message_timestamp),
  };
}

/** `shopId` decides direction: Shopee marks seller-sent messages with our shop id. */
export function toMessage(m: ShopeeMessage, shopId: number): Message {
  return {
    id: m.message_id,
    from: m.from_shop_id === shopId ? "shop" : "customer",
    type: m.message_type,
    text: m.content.text ?? null,
    url: m.content.url ?? null,
    at: toMs(m.created_timestamp) ?? 0,
  };
}

const num = (v: unknown): number | null => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export function toVoucher(v: ShopeeVoucher): Voucher {
  return {
    id: String(v.voucher_id ?? ""),
    code: v.voucher_code ?? "",
    name: v.voucher_name ?? "",
    percentage: num(v.percentage) || null, // Shopee sends 0 on fixed-amount vouchers
    amount: num(v.discount_amount),
    starts_at: toMs(v.start_time) ?? 0,
    ends_at: toMs(v.end_time) ?? 0,
  };
}

export function toAdReport(r: ShopeeAdRow): AdReport {
  return {
    campaign_id: String(r.campaign_id ?? ""),
    campaign_name: String(r.campaign_name ?? ""),
    impressions: num(r.impression),
    clicks: num(r.clicks),
    ctr: num(r.ctr),
    spend: num(r.expense),
    gmv: num(r.gmv),
    roas: num(r.roi),
  };
}
