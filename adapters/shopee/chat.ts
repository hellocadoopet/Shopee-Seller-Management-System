import type { ChatCapability } from "../types.js";
import { getConversationList, getMessageList, sendMessage } from "./api/index.js";
import { toConversation, toMessage } from "./utils/mappers.js";

export const chat: ChatCapability = {
  async listConversations({ accessToken, externalId }, { unreadOnly, cursor = "" }) {
    const r = await getConversationList(accessToken, Number(externalId), unreadOnly ? "unread" : "all", cursor);
    return {
      conversations: (r.conversations ?? []).map(toConversation),
      next: r.page_result.more ? r.page_result.next_cursor.next_message_time_nano : null,
    };
  },

  async listMessages({ accessToken, externalId }, conversationId) {
    const shopId = Number(externalId);
    const r = await getMessageList(accessToken, shopId, conversationId);
    return (r.messages ?? []).map((m) => toMessage(m, shopId));
  },

  /** Shopee addresses a reply to the buyer's user id, not the conversation. */
  async send({ accessToken, externalId }, { peerId }, text) {
    await sendMessage(accessToken, Number(externalId), Number(peerId), text);
  },
};
