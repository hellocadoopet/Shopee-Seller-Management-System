import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../lib/config.js";

const here = dirname(fileURLToPath(import.meta.url));

// Supabase settings come from lib/config (same env vars as the dashboard).
export const workerEnv = {
  /** Shared with the dashboard; every route except GET /health requires it as a Bearer token. */
  secret: process.env.WA_WORKER_SECRET ?? "",
  /** One Baileys auth folder per account: <dir>/<accountId>/. Losing it means re-scanning the QR. */
  sessionsDir: resolve(process.env.WA_SESSIONS_DIR || resolve(here, "wa-sessions")),
  // PORT is what hosts like Railway assign. Not 4000 on the VPS: the old wa-manager worker uses it.
  port: Number(process.env.WA_WORKER_PORT || process.env.PORT || 4100),
};

/** Throws if anything the worker can't run without is unset. */
export function assertWorkerEnv() {
  const missing = [
    ["WA_WORKER_SECRET", workerEnv.secret],
    ["SUPABASE_URL", config.supabase.url],
    ["SUPABASE_SERVICE_ROLE_KEY", config.supabase.serviceRoleKey],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing env: ${missing.join(", ")}`);
}
