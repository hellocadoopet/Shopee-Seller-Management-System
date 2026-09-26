export const whatsappConfig = {
  /** Public HTTPS URL of the always-on worker (worker/), e.g. https://wa.example.com */
  workerUrl: (process.env.WA_WORKER_URL ?? "").replace(/\/+$/, ""),
  /** Shared secret; the worker requires it as a Bearer token on every call. */
  workerSecret: process.env.WA_WORKER_SECRET ?? "",
};

export function missingWhatsappConfig(): string[] {
  const missing: string[] = [];
  if (!whatsappConfig.workerUrl) missing.push("WA_WORKER_URL");
  if (!whatsappConfig.workerSecret) missing.push("WA_WORKER_SECRET");
  return missing;
}
