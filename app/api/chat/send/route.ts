import { NextRequest, NextResponse } from "next/server";
import { getFreshAccessToken } from "@/lib/tokens";
import { sendMessage } from "@/lib/shopee";
import { getCurrentShopId } from "@/lib/currentShop";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const shopId = await getCurrentShopId();
  if (!shopId) return NextResponse.json({ error: "no shop connected" }, { status: 400 });

  const { to_buyer_id, text, source } = (await req.json()) as {
    to_buyer_id: number;
    text: string;
    source: "manual" | "rule" | "llm";
  };

  const auth = await getFreshAccessToken(shopId);
  await sendMessage(auth.accessToken, auth.shopeeShopId, to_buyer_id, text);

  await supabase.from("chatbot_replies").insert({
    shop_id: shopId,
    conversation_id: `conv-${to_buyer_id}`,
    triggered_by: source,
    reply_text: text,
  });

  return NextResponse.json({ ok: true });
}
