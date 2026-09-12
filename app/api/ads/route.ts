import { NextRequest, NextResponse } from "next/server";
import { getFreshAccessToken } from "@/lib/tokens";
import { getAdsPerformance } from "@/lib/shopee";
import { getCurrentShopId } from "@/lib/currentShop";

export async function GET(req: NextRequest) {
  const shopId = await getCurrentShopId();
  if (!shopId) return NextResponse.json({ error: "no shop connected" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start_date") ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const end = searchParams.get("end_date") ?? new Date().toISOString().slice(0, 10);

  const auth = await getFreshAccessToken(shopId);
  const res = await getAdsPerformance(auth.accessToken, auth.shopeeShopId, start, end);
  // Guard: some ads endpoints return no report_list (e.g. account has no ads).
  // Never send undefined — the page maps over this array.
  return NextResponse.json({ reports: res.report_list ?? [] });
}
