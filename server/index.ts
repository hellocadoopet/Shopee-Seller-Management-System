// API server: Railway in production (railway injects PORT), :8787 locally where Vite proxies /api here.
import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.API_PORT || process.env.PORT || 8787);
serve({ fetch: app.fetch, port }, () => console.log(`API on :${port}`));

// As PID 1 in the container, node ignores SIGTERM without a handler; Railway would wait, then SIGKILL.
process.on("SIGTERM", () => process.exit(0));
