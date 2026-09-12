function required(name: string, val: string | undefined): string {
  if (!val || val === "") throw new Error(`Missing env: ${name}`);
  return val;
}

export const config = {
  shopee: {
    partnerId: Number(process.env.SHOPEE_PARTNER_ID ?? 0),
    partnerKey: process.env.SHOPEE_PARTNER_KEY ?? "",
    env: (process.env.SHOPEE_ENV ?? "sandbox") as "sandbox" | "live",
    redirectUrl: process.env.SHOPEE_REDIRECT_URL ?? "",
  },
  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  },
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",
  llm: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    model: process.env.LLM_MODEL ?? "claude-haiku-4-5-20251001",
  },
};

/** Throws if any required env var is missing. Call at the top of API routes. */
export function assertConfig() {
  required("SHOPEE_PARTNER_ID", String(config.shopee.partnerId));
  required("SHOPEE_PARTNER_KEY", config.shopee.partnerKey);
  required("SHOPEE_REDIRECT_URL", config.shopee.redirectUrl);
  required("NEXT_PUBLIC_SUPABASE_URL", config.supabase.url);
  required("SUPABASE_SERVICE_ROLE_KEY", config.supabase.serviceRoleKey);
  required("TOKEN_ENCRYPTION_KEY", config.tokenEncryptionKey);
}
