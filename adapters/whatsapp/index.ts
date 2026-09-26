/**
 * WhatsApp via Baileys (the WhatsApp Web linked-device protocol), not Meta's official Cloud API.
 * The sockets live in the always-on worker (worker/), which Vercel can't host. This adapter:
 *   - reads chats from the tables the worker writes — the inbox works even while the worker restarts;
 *   - calls the worker for what needs the live socket: pairing (QR) and sending.
 * Scope today: read 1:1 chats (with media of live messages) and reply with text. No groups,
 * campaigns or auto-reply.
 */
import type { PlatformAdapter } from "../types.js";
import { missingWhatsappConfig } from "./config.js";
import * as store from "./api/store.js";
import * as worker from "./api/worker.js";
import { toConversation, toMessage } from "./utils/mappers.js";

export const whatsapp: PlatformAdapter = {
  id: "whatsapp",
  label: "WhatsApp",
  missingConfig: missingWhatsappConfig,
  tokenless: true, // the worker holds each number's session; nothing stored in shop_tokens

  pairing: {
    async start(label) {
      return { pairingId: (await worker.startPairing({ label })).pairing_id };
    },
    async status(pairingId) {
      try {
        const s = await worker.getPairing(pairingId);
        return { state: s.state, qr: s.qr_data_url, shop_id: s.shop_id, reason: s.reason };
      } catch (e) {
        if (e instanceof worker.WorkerError && e.status === 404) return { state: "failed", reason: "This QR code expired — start again." };
        throw e;
      }
    },
    async cancel(pairingId) {
      await worker.cancelPairing(pairingId);
    },
  },

  chat: {
    // One page of the newest conversations (60); the worker keeps them ordered by last message.
    async listConversations({ externalId }, { unreadOnly }) {
      return { conversations: (await store.listConversations(externalId, unreadOnly)).map(toConversation), next: null };
    },
    async listMessages({ externalId }, conversationId) {
      const messages = await store.listMessages(externalId, conversationId);
      const [urls] = await Promise.all([store.signMediaUrls(messages), store.markRead(externalId, conversationId)]);
      return messages.map((m) => toMessage(m, m.media_path ? (urls.get(m.media_path) ?? null) : null));
    },
    async send({ externalId }, { conversationId }, text) {
      const jid = await store.replyTarget(externalId, conversationId);
      if (!jid) throw new Error("whatsapp: conversation not found on this number");
      await worker.sendText(externalId, { jid, text });
    },
  },
};
