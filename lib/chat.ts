import type { ShopAuth } from "./tokens";
import {
  getConversationList,
  getMessageList,
  sendMessage,
  type ShopeeConversation,
  type ShopeeMessage,
} from "./shopee";
import * as mock from "./mockChat";

/**
 * Chat data source. Real Shopee by default; MOCK_CHAT=true swaps in seeded, in-memory buyer
 * conversations — the sandbox can't create buyer chats (buyers must message the shop first),
 * so this is how the inbox is developed and demoed. Never enable it in production.
 */
const useMock = () => process.env.MOCK_CHAT === "true";

export async function listConversations(
  auth: ShopAuth,
  type: "all" | "unread",
  cursor = "",
): Promise<{ conversations: ShopeeConversation[]; more: boolean; next: string }> {
  if (useMock()) return { conversations: mock.conversations(auth, type), more: false, next: "" };
  const r = await getConversationList(auth.accessToken, auth.shopeeShopId, type, cursor);
  return {
    conversations: r.conversations ?? [],
    more: r.page_result.more,
    next: r.page_result.next_cursor.next_message_time_nano,
  };
}

export async function listMessages(auth: ShopAuth, conversationId: string): Promise<ShopeeMessage[]> {
  if (useMock()) return mock.messages(auth, conversationId);
  return (await getMessageList(auth.accessToken, auth.shopeeShopId, conversationId)).messages ?? [];
}

export async function send(auth: ShopAuth, toId: number, text: string): Promise<void> {
  if (useMock()) return mock.send(auth, toId, text);
  await sendMessage(auth.accessToken, auth.shopeeShopId, toId, text);
}
