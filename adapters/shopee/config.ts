export const shopeeConfig = {
  partnerId: Number(process.env.SHOPEE_PARTNER_ID ?? 0),
  partnerKey: process.env.SHOPEE_PARTNER_KEY ?? "",
  env: (process.env.SHOPEE_ENV || "sandbox") as "sandbox" | "live",
  redirectUrl: process.env.SHOPEE_REDIRECT_URL ?? "",
};

// Shopee Open Platform v2 hosts (Southeast Asia region — Malaysia/Singapore/etc.)
export const HOSTS = {
  live: "https://partner.shopeemobile.com",
  sandbox: "https://openplatform.sandbox.test-stable.shopee.sg",
} as const;

export function missingShopeeConfig(): string[] {
  const missing: string[] = [];
  if (!shopeeConfig.partnerId) missing.push("SHOPEE_PARTNER_ID");
  if (!shopeeConfig.partnerKey) missing.push("SHOPEE_PARTNER_KEY");
  if (!shopeeConfig.redirectUrl) missing.push("SHOPEE_REDIRECT_URL");
  return missing;
}
