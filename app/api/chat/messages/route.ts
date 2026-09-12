import { NextRequest, NextResponse } from "next/server";
import { getFreshAccessToken } from "@/lib/tokens";
import { getMessageList } from "@/lib/shopee";
import { getCurrentShopId } from "@/lib/currentShop";

export async function GET(req: NextRequest) {
  const shopId = await getCurrentShopId();
  if (!shopId) return NextResponse.json({ error: "no shop connected" }, { status: 400 });

  const conversationId = new URL(req.url).searchParams.get("conversation_id");
  if (!conversationId) return NextResponse.json({ error: "conversation_id required" }, { status: 400 });

  const auth = await getFreshAccessToken(shopId);
  const res = await getMessageList(auth.accessToken, auth.shopeeShopId, conversationId);
  return NextResponse.json({ messages: res.messages });
}
