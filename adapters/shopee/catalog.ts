import type { CatalogCapability } from "../types.js";
import { getItemBaseInfo, getItemList, updateItemPrice } from "./api/index.js";
import type { ShopeeItemBase } from "./types.js";
import { toProduct } from "./utils/mappers.js";

export const catalog: CatalogCapability = {
  /** All NORMAL items with price + stock: pages get_item_list (100/page), then base info in batches of 50. */
  async list({ accessToken, externalId }) {
    const shopId = Number(externalId);
    const ids: number[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await getItemList(accessToken, shopId, offset, 100);
      ids.push(...(page.item ?? []).map((i) => i.item_id));
      if (!page.has_next_page) break;
    }

    const base: ShopeeItemBase[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const r = await getItemBaseInfo(accessToken, shopId, ids.slice(i, i + 50));
      base.push(...(r.item_list ?? []));
    }
    return base.map(toProduct);
  },

  /** Single-price items only; variant products need per-model prices (not supported yet). */
  async updatePrice({ accessToken, externalId }, productId, price) {
    await updateItemPrice(accessToken, Number(externalId), Number(productId), [{ original_price: price }]);
  },
};
