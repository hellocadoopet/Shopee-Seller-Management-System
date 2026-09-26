// Calls to the WhatsApp worker — only for what needs its live socket (pairing, sending).
import { whatsappConfig } from "../config.js";
import type { PairingStatusResponse, SendRequest, SendResponse, StartPairingRequest, StartPairingResponse } from "../contract.js";

export class WorkerError extends Error {
  constructor(
    public status: number,
    msg: string,
  ) {
    super(`[whatsapp worker ${status}] ${msg}`);
    this.name = "WorkerError";
  }
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${whatsappConfig.workerUrl}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${whatsappConfig.workerSecret}`, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000), // sends include a few seconds of simulated typing
    });
  } catch (e) {
    throw new WorkerError(0, `worker unreachable (${String(e)})`);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new WorkerError(res.status, data.error ?? res.statusText);
  return data;
}

export const startPairing = (req: StartPairingRequest) => call<StartPairingResponse>("/pairings", { method: "POST", body: req });

export const getPairing = (id: string) => call<PairingStatusResponse>(`/pairings/${encodeURIComponent(id)}`);

export const cancelPairing = (id: string) => call<{ ok: true }>(`/pairings/${encodeURIComponent(id)}`, { method: "DELETE" });

export const sendText = (accountId: string, req: SendRequest) =>
  call<SendResponse>(`/accounts/${encodeURIComponent(accountId)}/send`, { method: "POST", body: req });
