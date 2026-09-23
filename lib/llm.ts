import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";

export type LlmProvider = "claude" | "openai" | "deepseek";

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
}

export const PROVIDER_LABELS: Record<LlmProvider, string> = {
  claude: "Claude (Anthropic)",
  openai: "ChatGPT (OpenAI)",
  deepseek: "DeepSeek",
};

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  claude: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  deepseek: "deepseek-chat",
};

// Where to get an API key — shown in the Settings UI.
export const KEY_HELP: Record<LlmProvider, string> = {
  claude: "console.anthropic.com → API Keys",
  openai: "platform.openai.com → API keys",
  deepseek: "platform.deepseek.com → API keys",
};

/** AI settings come from env: LLM_PROVIDER, LLM_API_KEY, LLM_MODEL (optional). */
export function getLlmConfig(): LlmConfig {
  const provider = (Object.keys(PROVIDER_LABELS).includes(config.llm.provider) ? config.llm.provider : "claude") as LlmProvider;
  return { provider, apiKey: config.llm.apiKey, model: config.llm.model || DEFAULT_MODELS[provider] };
}

/**
 * Generate a reply using whichever provider is configured.
 * OpenAI and DeepSeek share the same request shape (OpenAI-compatible),
 * so they go through one code path; Claude uses the Anthropic SDK.
 */
export async function generateReply(
  cfg: LlmConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  if (!cfg.apiKey) {
    throw new Error("No AI API key configured. Set LLM_API_KEY in env.");
  }

  if (cfg.provider === "claude") {
    const client = new Anthropic({ apiKey: cfg.apiKey });
    const msg = await client.messages.create({
      model: cfg.model || DEFAULT_MODELS.claude,
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = msg.content[0];
    return block?.type === "text" ? block.text.trim() : "";
  }

  // OpenAI + DeepSeek (OpenAI-compatible chat completions)
  const baseUrl = cfg.provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1";
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model || DEFAULT_MODELS[cfg.provider],
      max_tokens: 256,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`${cfg.provider} API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}
