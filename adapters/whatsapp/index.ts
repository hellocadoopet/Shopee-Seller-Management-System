/**
 * WhatsApp Cloud API — scaffold. What works: sending a reply, and the webhook handshake +
 * signature check. What's missing before a WhatsApp number can be used:
 *   - connect: Meta's Embedded Signup (Facebook Login) to obtain a number's token. Until then no
 *     WhatsApp shop can be created, so none of this is reachable from the UI.
 *   - an inbox: the Cloud API has no endpoint to read chat history. Incoming messages arrive only
 *     via the webhook, so they must be stored (a messages table) for listConversations/listMessages.
 */
import { NotSupportedError, type PlatformAdapter } from "../types.js";
import { missingWhatsappConfig, whatsappConfig } from "./config.js";
import { sendText } from "./api/index.js";
import type { WebhookPayload } from "./types.js";
import { verifySignature } from "./utils/signature.js";

export const whatsapp: PlatformAdapter = {
  id: "whatsapp",
  label: "WhatsApp",
  missingConfig: missingWhatsappConfig,

  chat: {
    async listConversations() {
      throw new NotSupportedError("whatsapp", "reading conversations (needs webhook message storage)");
    },
    async listMessages() {
      throw new NotSupportedError("whatsapp", "reading messages (needs webhook message storage)");
    },
    /** On WhatsApp the conversation is the customer's number, so peerId is their wa_id. */
    async send({ accessToken, externalId }, { peerId }, text) {
      await sendText(accessToken, externalId, peerId, text);
    },
  },

  webhook: {
    challenge(query) {
      const ok = query["hub.mode"] === "subscribe" && !!whatsappConfig.verifyToken && query["hub.verify_token"] === whatsappConfig.verifyToken;
      return ok ? (query["hub.challenge"] ?? null) : null;
    },
    verify(req) {
      return verifySignature(whatsappConfig.appSecret, req.body, req.header("x-hub-signature-256"));
    },
    async handle(body) {
      const payload = JSON.parse(body) as WebhookPayload;
      const incoming = payload.entry.flatMap((e) => e.changes.flatMap((c) => c.value.messages ?? []));
      // TODO persist incoming messages so the inbox can list them (see header comment)
      console.log("WhatsApp webhook:", { messages: incoming.length });
    },
  },
};
