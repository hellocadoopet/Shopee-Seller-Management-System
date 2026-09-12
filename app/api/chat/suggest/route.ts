import { NextRequest, NextResponse } from "next/server";
import { matchRule, suggestReply } from "@/lib/chatbot";
import { getCurrentShopId } from "@/lib/currentShop";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const shopId = await getCurrentShopId();
  if (!shopId) return NextResponse.json({ error: "no shop connected" }, { status: 400 });

  const { buyer_message } = (await req.json()) as { buyer_message: string };

  // 1. Try rules first
  const { data: rules } = await supabase
    .from("chatbot_rules")
    .select("*")
    .eq("shop_id", shopId)
    .eq("active", true)
    .order("priority", { ascending: true });

  const ruleHit = matchRule(buyer_message, rules ?? []);
  if (ruleHit) {
    return NextResponse.json({ source: "rule", reply: ruleHit.reply, rule_id: ruleHit.id });
  }

  // 2. Fall back to LLM, using past manual replies as style examples
  const { data: history } = await supabase
    .from("chatbot_replies")
    .select("reply_text")
    .eq("shop_id", shopId)
    .eq("triggered_by", "manual")
    .order("sent_at", { ascending: false })
    .limit(20);

  const reply = await suggestReply({
    buyerMessage: buyer_message,
    pastManualReplies: (history ?? []).map((h) => h.reply_text),
  });
  return NextResponse.json({ source: "llm", reply });
}
