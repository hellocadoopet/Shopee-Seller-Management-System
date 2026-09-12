import { NextRequest, NextResponse } from "next/server";
import { getFreshAccessToken } from "@/lib/tokens";
import { getItemList, getItemBaseInfo, updateItemPrice, type ShopeeItemBase } from "@/lib/shopee";
import { getCurrentShopId } from "@/lib/currentShop";

export async function GET() {
  const shopId = await getCurrentShopId();
  if (!shopId) return NextResponse.json({ error: "no shop connected" }, { status: 400 });

  try {
    const auth = await getFreshAccessToken(shopId);

    // 1. Get the item IDs (list endpoint has no prices)
    const list = await getItemList(auth.accessToken, auth.shopeeShopId, 0, 100);
    const ids = list.item.map((i) => i.item_id);
    if (!ids.length) return NextResponse.json({ items: [] });

    // 2. Get names, prices, stock in batches of 50 (no per-item calls)
    const base: ShopeeItemBase[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const r = await getItemBaseInfo(auth.accessToken, auth.shopeeShopId, ids.slice(i, i + 50));
      base.push(...r.item_list);
    }

    const items = base.map((b) => ({
      item_id: b.item_id,
      item_name: b.item_name,
      item_sku: b.item_sku,
      item_status: b.item_status,
      has_model: b.has_model,
      // price_info is populated for single-variant items; variant items need a
      // separate model lookup (shown as "—" here for now).
      price: b.price_info?.[0]?.current_price ?? null,
      stock: b.stock_info_v2?.summary_info?.total_available_stock ?? null,
    }));

    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const shopId = await getCurrentShopId();
  if (!shopId) return NextResponse.json({ error: "no shop connected" }, { status: 400 });

  const body = (await req.json()) as {
    item_id: number;
    price_list: Array<{ model_id?: number; original_price: number }>;
  };
  try {
    const auth = await getFreshAccessToken(shopId);
    const res = await updateItemPrice(auth.accessToken, auth.shopeeShopId, body.item_id, body.price_list);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
