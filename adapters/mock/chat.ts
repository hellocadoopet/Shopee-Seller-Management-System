// Dev-only seeded customer chats (MOCK_CHAT=true). The factory swaps this in for a platform's
// real chat — the Shopee sandbox can't create buyer chats (buyers must message the shop first),
// so this is how the inbox is developed and demoed. In memory: resets when the server restarts.
import type { ChatCapability, Conversation, Credentials, Message } from "../types.js";

type Line = [from: "customer" | "shop", text: string, minutesAgo: number];

// Typical Shopee MY pet-shop chats — English / Bahasa / Chinese mix, as real buyers write.
const SEED: Array<{ name: string; unread: number; lines: Line[] }> = [
  { name: "aisyah_meow", unread: 2, lines: [
    ["customer", "Hi, cat food salmon 1.5kg ada stok lagi?", 12],
    ["customer", "Nak order 3 pack, boleh pos hari ni?", 10],
  ] },
  { name: "jasonlim88", unread: 1, lines: [
    ["customer", "Hello, my order haven't ship yet. Order placed 2 days ago", 45],
  ] },
  { name: "mei_ling.pets", unread: 1, lines: [
    ["customer", "请问猫砂是豆腐砂还是膨润土的？", 90],
  ] },
  { name: "farhan_k9", unread: 0, lines: [
    ["customer", "Dog chew bone ni sesuai untuk puppy 4 bulan?", 300],
    ["shop", "Hi! Sesuai untuk 6 bulan ke atas ya. Untuk puppy kami cadangkan saiz small 😊", 290],
    ["customer", "Ok terima kasih", 285],
  ] },
  { name: "priya.r", unread: 3, lines: [
    ["customer", "Received the scratching post but one screw missing", 25],
    ["customer", "Can send replacement?", 24],
    ["customer", "Or refund partial?", 20],
  ] },
  { name: "kokoandmochi", unread: 0, lines: [
    ["customer", "Shampoo lavender safe for cats?", 1440],
    ["shop", "Yes, it's pet-safe and gentle for cats & dogs.", 1400],
  ] },
];

interface Store {
  conversations: Conversation[];
  messages: Map<string, Message[]>;
}
const stores = new Map<string, Store>();

/** Stable small hash so each shop gets its own slice/order of the seed. */
const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

function store({ externalId }: Credentials): Store {
  let st = stores.get(externalId);
  if (st) return st;
  const h = hash(externalId);
  const now = Date.now();
  st = { conversations: [], messages: new Map() };
  SEED.filter((_, i) => (i + h) % 4 !== 0) // ~3/4 of the seed, varies per shop
    .forEach((c, i) => {
      const id = `mock-${h}-${i}`;
      const msgs: Message[] = c.lines.map(([from, text, ago], j) => ({
        id: `${id}-${j}`,
        from,
        type: "text",
        text,
        url: null,
        filename: null,
        at: now - ago * 60_000,
      }));
      st!.messages.set(id, msgs);
      st!.conversations.push({
        id,
        peer_id: String(900000 + (h % 1000) * 10 + i),
        peer_name: c.name,
        unread: c.unread,
        last_text: c.lines.at(-1)![1],
        last_at: msgs.at(-1)!.at,
      });
    });
  stores.set(externalId, st);
  return st;
}

export const mockChat: ChatCapability = {
  async listConversations(creds, { unreadOnly }) {
    const list = [...store(creds).conversations].sort((a, b) => (b.last_at ?? 0) - (a.last_at ?? 0));
    return { conversations: unreadOnly ? list.filter((c) => c.unread > 0) : list, next: null };
  },

  async listMessages(creds, conversationId) {
    const st = store(creds);
    const conv = st.conversations.find((c) => c.id === conversationId);
    if (conv) conv.unread = 0; // opening a thread reads it
    return st.messages.get(conversationId) ?? [];
  },

  async send(creds, { conversationId }, text) {
    const st = store(creds);
    const conv = st.conversations.find((c) => c.id === conversationId);
    if (!conv) throw new Error(`mock chat: no conversation ${conversationId}`);
    const at = Date.now();
    st.messages.get(conversationId)!.push({ id: `${conversationId}-${at}`, from: "shop", type: "text", text, url: null, filename: null, at });
    Object.assign(conv, { last_text: text, last_at: at, unread: 0 });
  },
};
