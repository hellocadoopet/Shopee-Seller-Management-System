/** The worker's HTTP API (adapters/whatsapp/contract.ts). Called only by the dashboard backend. */
import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type {
  HealthResponse,
  SendRequest,
  SendResponse,
  StartPairingRequest,
  StartPairingResponse,
} from "../adapters/whatsapp/contract.js";
import { logger } from "./logger.js";
import { isDirectChat } from "./wa/parse.js";
import type { SessionManager } from "./wa/manager.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Hash both sides so timingSafeEqual gets equal lengths and the secret's length doesn't leak.
const digest = (s: string) => createHash("sha256").update(s).digest();

export function createApp({ manager, secret }: { manager: SessionManager; secret: string }) {
  if (!secret) throw new Error("WA_WORKER_SECRET is required");
  const expected = digest(secret);
  const app = new Hono();

  app.onError((e, c) => {
    logger.error({ path: c.req.path, err: String(e) }, "request failed");
    return c.json({ error: "internal error" }, 500);
  });

  app.use(async (c, next) => {
    if (c.req.path === "/health") return next();
    const token = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1] ?? "";
    if (!timingSafeEqual(digest(token), expected)) return c.json({ error: "unauthorized" }, 401);
    return next();
  });

  app.get("/health", (c) => c.json<HealthResponse>({ ok: true, accounts: manager.health() }));

  app.post("/pairings", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as StartPairingRequest;
    const label = typeof body.label === "string" ? body.label : undefined;
    return c.json<StartPairingResponse>({ pairing_id: await manager.startPairing(label) });
  });

  app.get("/pairings/:id", (c) => {
    const status = manager.getPairing(c.req.param("id"));
    return status ? c.json(status) : c.json({ error: "unknown or expired pairing" }, 404);
  });

  app.delete("/pairings/:id", async (c) => {
    const found = await manager.cancelPairing(c.req.param("id"));
    return found ? c.json({ ok: true }) : c.json({ error: "unknown or expired pairing" }, 404);
  });

  app.post("/accounts/:accountId/send", async (c) => {
    const accountId = c.req.param("accountId");
    if (!UUID.test(accountId)) return c.json({ error: "unknown account" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Partial<SendRequest>;
    if (!isDirectChat(body.jid) || typeof body.text !== "string" || !body.text.trim()) {
      return c.json({ error: "jid (a 1:1 chat) and non-empty text are required" }, 400);
    }
    const r = await manager.sendText(accountId, body.jid, body.text);
    if (r.ok) return c.json<SendResponse>({ message_id: r.messageId });
    return r.error === "not_found"
      ? c.json({ error: "unknown account" }, 404)
      : c.json({ error: "account is not connected" }, 409);
  });

  return app;
}
