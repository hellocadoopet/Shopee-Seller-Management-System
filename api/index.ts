// Vercel serverless entry — vercel.json rewrites /api/* here.
import { handle } from "hono/vercel";
import { app } from "../server/app.js";

const handler = handle(app);
export const GET = handler;
export const POST = handler;
