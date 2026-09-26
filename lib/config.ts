// Platform-neutral settings. Each platform's own env vars live in adapters/<platform>/config.ts.
export const config = {
  supabase: {
    url: process.env.SUPABASE_URL ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  },
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",
  llm: {
    provider: process.env.LLM_PROVIDER ?? "claude",
    // One key per provider; LLM_PROVIDER picks which one is used.
    keys: {
      claude: process.env.ANTHROPIC_API_KEY ?? "",
      openai: process.env.OPENAI_API_KEY ?? "",
      deepseek: process.env.DEEPSEEK_API_KEY ?? "",
    },
    model: process.env.LLM_MODEL ?? "",
  },
};

/** Throws if the database or token encryption isn't configured. */
export function assertCoreConfig() {
  const missing = [
    ["SUPABASE_URL", config.supabase.url],
    ["SUPABASE_SERVICE_ROLE_KEY", config.supabase.serviceRoleKey],
    ["TOKEN_ENCRYPTION_KEY", config.tokenEncryptionKey],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing env: ${missing.join(", ")}`);
}
