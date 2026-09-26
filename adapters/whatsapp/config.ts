export const whatsappConfig = {
  /** Meta app secret — signs every webhook POST (X-Hub-Signature-256). */
  appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
  /** Any string you choose; Meta echoes it back when you subscribe the webhook. */
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
  // Graph API versions are retired about two years after release — keep this current.
  graphVersion: process.env.WHATSAPP_GRAPH_VERSION || "v21.0",
};

export const GRAPH_HOST = "https://graph.facebook.com";

export function missingWhatsappConfig(): string[] {
  const missing: string[] = [];
  if (!whatsappConfig.appSecret) missing.push("WHATSAPP_APP_SECRET");
  if (!whatsappConfig.verifyToken) missing.push("WHATSAPP_VERIFY_TOKEN");
  return missing;
}
