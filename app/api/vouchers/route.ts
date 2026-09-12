import { NextResponse } from "next/server";
import { getFreshAccessToken } from "@/lib/tokens";
import { getVoucherList } from "@/lib/shopee";
import { getCurrentShopId } from "@/lib/currentShop";

export async function GET() {
  const shopId = await getCurrentShopId();
  if (!shopId) return NextResponse.json({ error: "no shop connected" }, { status: 400 });

  const auth = await getFreshAccessToken(shopId);
  const res = await getVoucherList(auth.accessToken, auth.shopeeShopId, "all");
  return NextResponse.json({ vouchers: res.voucher_list });
}
