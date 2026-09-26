import type { SendMessageResponse } from "../types.js";
import { graph } from "./client.js";

/**
 * Free-form text only reaches a customer within 24h of their last message to you; outside that
 * window WhatsApp requires an approved template message instead.
 */
export function sendText(accessToken: string, phoneNumberId: string, to: string, text: string) {
  return graph<SendMessageResponse>(`${phoneNumberId}/messages`, accessToken, {
    method: "POST",
    body: { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text } },
  });
}

