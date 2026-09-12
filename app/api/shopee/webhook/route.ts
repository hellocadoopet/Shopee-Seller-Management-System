import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { config } from "@/lib/config";

/**
 * Shopee push notifications. We must verify the HMAC signature before trusting.
 * Common codes: 1=shop_authorization, 3=order_status, 10=new_message, 12=item_promotion
 */
export async function POST(req: NextRequest) {
  const sig = req.headers.get("authorization");
  const rawBody = await req.text();
  const fullUrl = req.url;

  if (!sig) return NextResponse.json({ error: "no signature" }, { status: 401 });

  const base = `${fullUrl}|${rawBody}`;
  const expected = crypto.createHmac("sha256", config.shopee.partnerKey.trim()).update(base).digest("hex");

  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as { code: number; shop_id?: number; data?: unknown };

  // TODO route by code:
  //   3 = order status → schedule order sync
  //   10 = chat message → trigger auto-reply rule
  // For now, just log + acknowledge.
  console.log("Shopee webhook:", { code: body.code, shop_id: body.shop_id });

  return NextResponse.json({ ok: true });
}
