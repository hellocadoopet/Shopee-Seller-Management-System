import { NextRequest, NextResponse } from "next/server";
import { getCurrentShopId } from "@/lib/currentShop";
import { syncOrders } from "@/lib/sync";

/**
 * Fetch orders for the selected period from Shopee, save them to the database,
 * and return them. Saving is what lets Insights + Overview show real numbers.
 */
export async function GET(req: NextRequest) {
  const shopId = await getCurrentShopId();
  if (!shopId) return NextResponse.json({ error: "no shop connected" }, { status: 400 });

  const days = Number(new URL(req.url).searchParams.get("days") ?? 7);

  try {
    const orders = await syncOrders(shopId, days);
    return NextResponse.json({ orders });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
