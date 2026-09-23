// Dev-only seeded buyer chats (MOCK_CHAT=true). In memory: resets when the server restarts.
import type { ShopAuth } from "./tokens";
import type { ShopeeConversation, ShopeeMessage } from "./shopee";

type Line = [from: "buyer" | "seller", text: string, minutesAgo: number];

// Typical Shopee MY pet-shop chats — English / Bahasa / Chinese mix, as real buyers write.
const SEED: Array<{ name: string; unread: number; lines: Line[] }> = [
  { name: "aisyah_meow", unread: 2, lines: [
    ["buyer", "Hi, cat food salmon 1.5kg ada stok lagi?", 12],
    ["buyer", "Nak order 3 pack, boleh pos hari ni?", 10],
  ] },
  { name: "jasonlim88", unread: 1, lines: [
    ["buyer", "Hello, my order haven't ship yet. Order placed 2 days ago", 45],
  ] },
  { name: "mei_ling.pets", unread: 1, lines: [
    ["buyer", "请问猫砂是豆腐砂还是膨润土的？", 90],
  ] },
  { name: "farhan_k9", unread: 0, lines: [
    ["buyer", "Dog chew bone ni sesuai untuk puppy 4 bulan?", 300],
    ["seller", "Hi! Sesuai untuk 6 bulan ke atas ya. Untuk puppy kami cadangkan saiz small 😊", 290],
    ["buyer", "Ok terima kasih", 285],
  ] },
  { name: "priya.r", unread: 3, lines: [
    ["buyer", "Received the scratching post but one screw missing", 25],
    ["buyer", "Can send replacement?", 24],
    ["buyer", "Or refund partial?", 20],
  ] },
  { name: "kokoandmochi", unread: 0, lines: [
    ["buyer", "Shampoo lavender safe for cats?", 1440],
    ["seller", "Yes, it's pet-safe and gentle for cats & dogs.", 1400],
  ] },
];

interface Store {
  conversations: ShopeeConversation[];
  messages: Map<string, ShopeeMessage[]>;
}
const stores = new Map<string, Store>();

/** Stable small hash so each shop gets its own slice/order of the seed. */
const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

function store(auth: ShopAuth): Store {
  let st = stores.get(auth.shopUuid);
  if (st) return st;
  const h = hash(auth.shopUuid);
  const picked = SEED.filter((_, i) => (i + h) % 4 !== 0); // ~3/4 of the seed, varies per shop
  const now = Date.now();
  st = { conversations: [], messages: new Map() };
  picked.forEach((c, i) => {
    const conversationId = `mock-${h}-${i}`;
    const buyerId = 900000 + (h % 1000) * 10 + i;
    const msgs: ShopeeMessage[] = c.lines.map(([from, text, ago], j) => ({
      message_id: `${conversationId}-${j}`,
      from_id: from === "buyer" ? buyerId : auth.shopeeShopId,
      to_id: from === "buyer" ? auth.shopeeShopId : buyerId,
      from_shop_id: from === "seller" ? auth.shopeeShopId : 0,
      message_type: "text",
      content: { text },
      created_timestamp: Math.floor((now - ago * 60_000) / 1000),
    }));
    st!.messages.set(conversationId, msgs);
    st!.conversations.push({
      conversation_id: conversationId,
      to_id: buyerId,
      to_name: c.name,
      unread_count: c.unread,
      latest_message_content: { text: c.lines.at(-1)![1] },
      last_message_timestamp: msgs.at(-1)!.created_timestamp * 1e9, // Shopee uses nanoseconds here
    });
  });
  stores.set(auth.shopUuid, st);
  return st;
}

export function conversations(auth: ShopAuth, type: "all" | "unread"): ShopeeConversation[] {
  const list = [...store(auth).conversations].sort((a, b) => (b.last_message_timestamp ?? 0) - (a.last_message_timestamp ?? 0));
  return type === "unread" ? list.filter((c) => c.unread_count > 0) : list;
}

export function messages(auth: ShopAuth, conversationId: string): ShopeeMessage[] {
  const st = store(auth);
  const conv = st.conversations.find((c) => c.conversation_id === conversationId);
  if (conv) conv.unread_count = 0; // opening a thread reads it
  return st.messages.get(conversationId) ?? [];
}

export function send(auth: ShopAuth, toId: number, text: string): void {
  const st = store(auth);
  const conv = st.conversations.find((c) => c.to_id === toId);
  if (!conv) throw new Error(`mock chat: no conversation with buyer ${toId}`);
  const now = Math.floor(Date.now() / 1000);
  st.messages.get(conv.conversation_id)!.push({
    message_id: `${conv.conversation_id}-${now}`,
    from_id: auth.shopeeShopId,
    to_id: toId,
    from_shop_id: auth.shopeeShopId,
    message_type: "text",
    content: { text },
    created_timestamp: now,
  });
  conv.latest_message_content = { text };
  conv.last_message_timestamp = now * 1e9;
  conv.unread_count = 0;
}
