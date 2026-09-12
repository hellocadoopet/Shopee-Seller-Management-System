import crypto from "node:crypto";
import { config } from "./config";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const k = Buffer.from(config.tokenEncryptionKey, "base64");
  if (k.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be 32 bytes base64. Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  return k;
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString("base64");
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const dec = crypto.createDecipheriv(ALGO, key(), iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]).toString("utf8");
}
