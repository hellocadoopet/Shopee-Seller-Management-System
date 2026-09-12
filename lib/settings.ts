import { supabase } from "./supabase";
import { encrypt, decrypt } from "./crypto";
import { config } from "./config";
import { DEFAULT_MODELS, type LlmProvider, type LlmConfig } from "./llm";

/**
 * The app's AI settings live in a single-row `app_settings` table.
 * The API key is encrypted at rest (same AES key as Shopee tokens).
 * If nothing is saved, we fall back to the ANTHROPIC_API_KEY env var.
 */
export async function getLlmConfig(): Promise<LlmConfig> {
  const { data } = await supabase
    .from("app_settings")
    .select("llm_provider, llm_api_key_enc, llm_model")
    .eq("id", 1)
    .maybeSingle();

  if (data?.llm_api_key_enc) {
    const provider = (data.llm_provider ?? "claude") as LlmProvider;
    return {
      provider,
      apiKey: decrypt(data.llm_api_key_enc),
      model: data.llm_model || DEFAULT_MODELS[provider],
    };
  }

  // Fallback: env var (Claude only)
  return { provider: "claude", apiKey: config.llm.apiKey, model: config.llm.model };
}

/** Public status for the Settings UI — never returns the key itself. */
export async function getSettingsStatus() {
  const { data } = await supabase
    .from("app_settings")
    .select("llm_provider, llm_model, llm_api_key_enc")
    .eq("id", 1)
    .maybeSingle();

  return {
    provider: (data?.llm_provider ?? "claude") as LlmProvider,
    model: data?.llm_model ?? "",
    hasKey: !!data?.llm_api_key_enc || !!config.llm.apiKey,
  };
}

/** Save provider + model, and (only if a new key is given) the encrypted key. */
export async function saveLlmConfig(provider: LlmProvider, apiKey: string | null, model: string) {
  const row: Record<string, unknown> = {
    id: 1,
    llm_provider: provider,
    llm_model: model,
    updated_at: new Date().toISOString(),
  };
  if (apiKey) row.llm_api_key_enc = encrypt(apiKey);
  await supabase.from("app_settings").upsert(row);
}
