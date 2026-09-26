/**
 * Live media → private Storage bucket. Runs AFTER the message row is saved, so a slow or failed
 * download never blocks the inbox or loses the message — media_path just stays null.
 */
import { supabase } from "../../lib/supabase.js";
import { MEDIA_BUCKET, MEDIA_MAX_BYTES, mediaObjectPath } from "../../adapters/whatsapp/contract.js";
import { logger } from "../logger.js";
import { extFor } from "./parse.js";
import type { Envelope } from "./session.js";

// Each file is held in memory while it's uploaded — cap how many are in flight at once.
const MAX_PARALLEL = 3;
let active = 0;
const waiting: Array<() => void> = [];

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export type MediaOutcome = "uploaded" | "none" | "too_large" | "download_failed" | "upload_failed";

/** Download, upload and set wa_messages.media_path. Never throws; logs ids + reason only (paths hold no PII). */
export async function attachMedia(accountId: string, conversationId: string, env: Envelope): Promise<MediaOutcome> {
  if (!env.media || !env.download) return "none";
  const ids = { accountId, waMessageId: env.waMessageId, type: env.type };
  if (env.media.size != null && env.media.size > MEDIA_MAX_BYTES) {
    logger.info({ ...ids, size: env.media.size }, "media skipped: too large");
    return "too_large";
  }
  return limited(async () => {
    let file: Buffer;
    try {
      file = await env.download!();
    } catch (err) {
      logger.warn({ ...ids, err: String(err) }, "media download failed");
      return "download_failed";
    }
    if (file.length > MEDIA_MAX_BYTES) {
      logger.info({ ...ids, size: file.length }, "media skipped: too large");
      return "too_large";
    }
    const path = mediaObjectPath({
      accountId,
      conversationId,
      waMessageId: env.waMessageId,
      ext: extFor(env.media!.mime, env.media!.filename),
    });
    try {
      const up = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(path, file, { contentType: env.media!.mime ?? "application/octet-stream", upsert: true });
      if (up.error) throw new Error(up.error.message);
      const { error } = await supabase
        .from("wa_messages")
        .update({ media_path: path })
        .eq("account_id", accountId)
        .eq("wa_message_id", env.waMessageId);
      if (error) throw new Error(error.message);
    } catch (err) {
      logger.warn({ ...ids, err: String(err) }, "media upload failed");
      return "upload_failed";
    }
    return "uploaded";
  });
}

/** Boot: make sure the private bucket exists (the migration also creates it). */
export async function ensureMediaBucket(): Promise<void> {
  const { error } = await supabase.storage.createBucket(MEDIA_BUCKET, { public: false });
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`createBucket: ${error.message}`);
}
