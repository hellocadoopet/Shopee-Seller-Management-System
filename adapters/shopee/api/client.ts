import type { SignedRequest } from "../utils/signing.js";

export class ShopeeApiError extends Error {
  constructor(
    public error: string,
    public requestId: string,
    msg: string,
  ) {
    super(`[${error}] ${msg} (req=${requestId})`);
    this.name = "ShopeeApiError";
  }
  isAuthError() {
    return ["error_auth", "error_token_expired", "error_invalid_access_token"].includes(this.error);
  }
}

/**
 * Most shop endpoints wrap their payload in `response` ({error, message, request_id, response: {...}});
 * auth and get_shop_info return it at the top level. We unwrap here so callers get the payload either way.
 */
export async function execute<T>(req: SignedRequest, method: "GET" | "POST", body?: unknown): Promise<T> {
  const res = await fetch(req.url, {
    method,
    headers: req.headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json()) as { error?: string; message?: string; request_id?: string; response?: T } & T;
  if (data.error && data.error !== "") {
    throw new ShopeeApiError(data.error, data.request_id ?? "", data.message ?? "Shopee API error");
  }
  return data.response ?? data;
}
