// Shared password gate. Edge-safe (uses Web Crypto, no node:crypto / Buffer),
// so it works in both middleware (edge) and route handlers (node).
//
// The auth cookie holds a token derived from server secrets. Only the login
// route (which checks APP_PASSWORD) can hand it out, and it can't be forged
// without knowing TOKEN_ENCRYPTION_KEY + APP_PASSWORD.

function bytes(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeAuthToken(): Promise<string> {
  const secret = process.env.TOKEN_ENCRYPTION_KEY ?? "shopee-solo";
  const password = process.env.APP_PASSWORD ?? "";
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, bytes("auth:" + password));
  return toHex(sig);
}

/** The lock is only active when APP_PASSWORD is set (so local dev stays open). */
export function isLockEnabled(): boolean {
  return !!process.env.APP_PASSWORD;
}
