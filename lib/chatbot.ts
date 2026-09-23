import { generateReply, getLlmConfig, KEY_ENV } from "./llm";
import chatbotConfig from "../config/chatbot.json";

/** Keyword rules, checked in file order (first match wins). Edit config/chatbot.json. */
export interface ChatbotRule {
  name: string;
  trigger_keywords: string[];
  match_mode: "any" | "all" | "regex";
  reply_template: string;
}

export interface RuleMatch {
  rule_name: string;
  reply: string;
}

export const rules = chatbotConfig.rules as ChatbotRule[];
/** Example seller replies the AI copies the tone of (English / Bahasa / Chinese mix). */
export const toneExamples = chatbotConfig.tone_examples as string[];

export function matchRule(buyerMessage: string, rules: ChatbotRule[]): RuleMatch | null {
  const text = buyerMessage.toLowerCase().trim();
  if (!text) return null;

  for (const r of rules) {
    let hit = false;

    if (r.match_mode === "regex") {
      try {
        const p = r.trigger_keywords[0];
        if (p && new RegExp(p, "i").test(buyerMessage)) hit = true;
      } catch {
        continue;
      }
    } else {
      const kws = r.trigger_keywords.map((k) => k.toLowerCase());
      hit = r.match_mode === "all" ? kws.every((k) => text.includes(k)) : kws.some((k) => text.includes(k));
    }

    if (hit) {
      return {
        rule_name: r.name,
        reply: r.reply_template.replace(/\{\{buyer_message\}\}/g, buyerMessage),
      };
    }
  }
  return null;
}

/**
 * LLM-generated reply suggestion. We feed the seller's past manual replies
 * as few-shot examples so the model picks up their tone (English, Bahasa,
 * Chinese mix common in Shopee MY).
 *
 * We never auto-send LLM replies — they're suggestions for the seller to approve.
 */
export async function suggestReply(buyerMessage: string): Promise<string> {
  const cfg = getLlmConfig();
  if (!cfg.apiKey) {
    return `(No AI connected — set ${KEY_ENV[cfg.provider]} in env)`;
  }

  const examples = toneExamples.slice(0, 10).map((r, i) => `${i + 1}. ${r}`).join("\n");

  const systemPrompt = [
    "You draft short, friendly Shopee Malaysia seller customer-service replies.",
    "Match the tone, language, and emoji style of the example replies (below).",
    "Sellers commonly mix English, Bahasa Malaysia, and Chinese.",
    "Keep under 200 characters. Never promise refunds, free items, or share external links unless asked.",
    "",
    "Example replies (mimic this style):",
    examples || "(no examples — use polite, neutral, helpful tone)",
  ].join("\n");

  const userPrompt = `Buyer said: "${buyerMessage}"\n\nDraft a reply:`;
  return generateReply(cfg, systemPrompt, userPrompt);
}
