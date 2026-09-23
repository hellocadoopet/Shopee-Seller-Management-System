import type { ShopAuth } from "./tokens";
import { getItemBaseInfo, getItemList, type ShopeeItemBase } from "./shopee";

export interface Product {
  item_id: number;
  item_name: string;
  item_sku: string;
  item_status: string;
  has_model: boolean;
  price: number | null; // null for variant items (price lives on each model)
  stock: number | null;
}

/** All NORMAL items with price + stock: pages get_item_list (100/page), then base info in batches of 50. */
export async function listProducts(auth: ShopAuth): Promise<Product[]> {
  const ids: number[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await getItemList(auth.accessToken, auth.shopeeShopId, offset, 100);
    ids.push(...(page.item ?? []).map((i) => i.item_id));
    if (!page.has_next_page) break;
  }

  const base: ShopeeItemBase[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await getItemBaseInfo(auth.accessToken, auth.shopeeShopId, ids.slice(i, i + 50));
    base.push(...(r.item_list ?? []));
  }

  return base.map((b) => ({
    item_id: b.item_id,
    item_name: b.item_name,
    item_sku: b.item_sku,
    item_status: b.item_status,
    has_model: b.has_model,
    price: b.price_info?.[0]?.current_price ?? null,
    stock: b.stock_info_v2?.summary_info?.total_available_stock ?? null,
  }));
}
