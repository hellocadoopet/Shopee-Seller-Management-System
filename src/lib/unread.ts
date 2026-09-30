import { useFetch, usePoll, type ShopList } from "./useFetch";

const POLL_MS = 30_000;

/**
 * Unread conversations across ALL shops (ignores ?shop=): the badge answers "anything needing me anywhere".
 * Polls every 30s while the tab is visible. null = unknown (loading or failed) → show nothing.
 */
export function useUnreadChats(): number | null {
  const { data, error, reload } = useFetch<ShopList<{ unread: number }>>("/api/chat/conversations?shop=all&type=unread");
  usePoll(reload, POLL_MS);
  if (error || !data) return null;
  return data.items.filter((c) => c.unread > 0).length;
}
