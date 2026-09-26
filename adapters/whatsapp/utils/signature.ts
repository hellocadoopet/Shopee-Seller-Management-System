import crypto from "node:crypto";

/** Meta signs each webhook POST: X-Hub-Signature-256: sha256=<hex HMAC-SHA256(app secret, raw body)>. */
export function verifySignature(appSecret: string, rawBody: string, header: string | undefined): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex"), "hex");
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
