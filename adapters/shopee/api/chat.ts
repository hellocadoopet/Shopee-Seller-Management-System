import type { ShopeeConversation, ShopeeMessage } from "../types.js";
import { signShop } from "../utils/signing.js";
import { execute } from "./client.js";

export function getMessageList(accessToken: string, shopId: number, conversationId: string, offset = "") {
  return execute<{ messages?: ShopeeMessage[]; page_result: { next_offset: string; more: boolean } }>(
    signShop("/api/v2/sellerchat/get_message", accessToken, shopId, {
      conversation_id: conversationId,
      offset,
      page_size: 50,
    }),
    "GET",
  );
}

/** Page with next_timestamp_nano from the previous page_result. */
export function getConversationList(
  accessToken: string,
  shopId: number,
  type: "all" | "unread" | "pinned",
  nextTimestampNano = "",
) {
  return execute<{
    conversations?: ShopeeConversation[];
    page_result: { more: boolean; next_cursor: { next_message_time_nano: string; conversation_id: string } };
  }>(
    signShop("/api/v2/sellerchat/get_conversation_list", accessToken, shopId, {
      direction: "older",
      type,
      page_size: 60,
      ...(nextTimestampNano ? { next_timestamp_nano: nextTimestampNano } : {}),
    }),
    "GET",
  );
}

export function sendMessage(accessToken: string, shopId: number, toBuyerId: number, text: string) {
  return execute(signShop("/api/v2/sellerchat/send_message", accessToken, shopId), "POST", {
    to_id: toBuyerId,
    message_type: "text",
    content: { text },
  });
}
