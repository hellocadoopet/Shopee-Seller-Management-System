import { GRAPH_HOST, whatsappConfig } from "../config.js";
import type { GraphErrorBody } from "../types.js";

export class WhatsappApiError extends Error {
  constructor(
    public code: number | undefined,
    msg: string,
  ) {
    super(`[whatsapp ${code ?? "error"}] ${msg}`);
    this.name = "WhatsappApiError";
  }
}

/** Call the Graph API as the business, e.g. graph("<phone_number_id>/messages", token, { method: "POST", body }). */
export async function graph<T>(
  path: string,
  accessToken: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${GRAPH_HOST}/${whatsappConfig.graphVersion}/${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json()) as T & GraphErrorBody;
  if (!res.ok || data.error) throw new WhatsappApiError(data.error?.code, data.error?.message ?? `HTTP ${res.status}`);
  return data;
}
