// WhatsApp worker: owns the Baileys sockets, writes the wa_* tables, serves the contract's HTTP API.
import { serve } from "@hono/node-server";
import { assertWorkerEnv, workerEnv } from "./env.js";
import { createApp } from "./http.js";
import { logger } from "./logger.js";
import { BaileysSession } from "./wa/baileys-session.js";
import { SessionManager } from "./wa/manager.js";
import { ensureMediaBucket } from "./wa/media.js";

const WATCHDOG_MS = 5 * 60_000;

try {
  assertWorkerEnv();
} catch (e) {
  logger.fatal(String(e));
  process.exit(1);
}

const manager = new SessionManager({
  sessionsDir: workerEnv.sessionsDir,
  createSession: (id, dir) => new BaileysSession(id, dir),
});

const server = serve({ fetch: createApp({ manager, secret: workerEnv.secret }).fetch, port: workerEnv.port }, () =>
  logger.info({ port: workerEnv.port, sessionsDir: workerEnv.sessionsDir }, "WA worker listening"),
);

await ensureMediaBucket().catch((err) => logger.error({ err: String(err) }, "media bucket check failed"));
await manager.resumeAll().catch((err) => logger.error({ err: String(err) }, "resumeAll failed"));
setInterval(() => void manager.watchdog().catch((err) => logger.error({ err: String(err) }, "watchdog failed")), WATCHDOG_MS).unref();

// A stray rejection (e.g. inside Baileys) must not take every socket down with it.
process.on("unhandledRejection", (err) => logger.error({ err: String(err) }, "unhandled rejection"));

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  setTimeout(() => process.exit(1), 8_000).unref();
  server.close();
  await manager.shutdown().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
