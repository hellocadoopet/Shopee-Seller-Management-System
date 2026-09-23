import { useEffect, useRef, useState } from "react";
import { RefreshCw, Sparkles, Send } from "lucide-react";
import { useShopParam } from "../lib/shops";
import { useFetch, type ShopList } from "../lib/useFetch";
import { ShopBadge, ShopErrors, useMultiShop } from "../components/Shop";

interface Conversation {
  conversation_id: string;
  to_id: number;
  to_name?: string;
  unread_count: number;
  latest_message_content?: { text?: string };
  last_message_timestamp?: number;
}

interface Message {
  message_id: string;
  from_shop_id: number;
  message_type: string;
  content: { text?: string; url?: string };
  created_timestamp: number;
}

/** Shopee mixes units: conversation times are nanoseconds, message times seconds. */
function toDate(ts: number | undefined): Date | null {
  if (!ts) return null;
  if (ts > 1e17) return new Date(ts / 1e6); // ns
  if (ts > 1e11) return new Date(ts); // ms
  return new Date(ts * 1000); // s
}

function timeLabel(ts: number | undefined): string {
  const d = toDate(ts);
  if (!d) return "";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

const convKey = (c: { shop_id: string; conversation_id: string }) => `${c.shop_id}:${c.conversation_id}`;

export default function ChatPage() {
  const [shop] = useShopParam();
  const multi = useMultiShop();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useFetch<ShopList<Conversation>>(
    `/api/chat/conversations?shop=${shop}&type=${unreadOnly ? "unread" : "all"}`,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const conv = list.data?.items.find((c) => convKey(c) === selected) ?? null;

  const totalUnread = list.data?.items.reduce((s, c) => s + c.unread_count, 0) ?? 0;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">
          Chat {totalUnread > 0 && <span className="text-base font-normal text-gray-500">· {totalUnread} unread</span>}
        </h1>
        <button onClick={list.reload} className="p-2 rounded-md border border-gray-200 hover:bg-gray-50" title="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>
      <ShopErrors errors={list.data?.errors} />
      {list.error && <p className="text-red-600 text-sm mb-4">Error: {list.error}</p>}

      <div className="flex flex-1 min-h-0 bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Conversation list */}
        <div className="w-80 shrink-0 border-r border-gray-200 flex flex-col">
          <div className="flex gap-1 p-2 border-b border-gray-100">
            {[false, true].map((u) => (
              <button
                key={String(u)}
                onClick={() => setUnreadOnly(u)}
                className={`flex-1 py-1.5 rounded-md text-sm ${unreadOnly === u ? "bg-gray-100 font-medium" : "text-gray-500 hover:bg-gray-50"}`}
              >
                {u ? "Unread" : "All"}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {list.loading && !list.data && <p className="p-4 text-sm text-gray-400">Loading…</p>}
            {list.data && !list.data.items.length && (
              <p className="p-4 text-sm text-gray-400">{unreadOnly ? "No unread chats." : "No conversations yet."}</p>
            )}
            {list.data?.items.map((c) => (
              <button
                key={convKey(c)}
                onClick={() => setSelected(convKey(c))}
                className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 ${selected === convKey(c) ? "bg-orange-50" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate ${c.unread_count ? "font-semibold" : ""}`}>{c.to_name ?? `Buyer ${c.to_id}`}</span>
                  <span className="text-xs text-gray-400 shrink-0">{timeLabel(c.last_message_timestamp)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-sm text-gray-500 truncate">{c.latest_message_content?.text ?? "…"}</span>
                  {c.unread_count > 0 && (
                    <span className="text-xs bg-shopee text-white rounded-full px-1.5 min-w-5 text-center shrink-0">{c.unread_count}</span>
                  )}
                </div>
                {multi && (
                  <div className="text-xs mt-1">
                    <ShopBadge shopId={c.shop_id} name={c.shop_name} />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Thread */}
        {conv ? (
          <Thread key={convKey(conv)} conv={conv} onSent={list.reload} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Pick a conversation</div>
        )}
      </div>
    </div>
  );
}

function Thread({ conv, onSent }: { conv: Conversation & { shop_id: string; shop_name: string }; onSent: () => void }) {
  const thread = useFetch<{ shopee_shop_id: number; messages: Message[] }>(
    `/api/chat/messages?shop_id=${conv.shop_id}&conversation_id=${encodeURIComponent(conv.conversation_id)}`,
  );
  const [draft, setDraft] = useState("");
  const [draftSource, setDraftSource] = useState<string | null>(null);
  const [busy, setBusy] = useState<"suggest" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const messages = [...(thread.data?.messages ?? [])].sort((a, b) => a.created_timestamp - b.created_timestamp);
  const isSeller = (m: Message) => m.from_shop_id === thread.data?.shopee_shop_id;

  useEffect(() => bottom.current?.scrollIntoView(), [messages.length]);

  // The buyer's latest unanswered messages — what a reply should respond to.
  const lastSeller = messages.map(isSeller).lastIndexOf(true);
  const pending = messages.slice(lastSeller + 1).map((m) => m.content.text).filter(Boolean).join("\n");

  async function suggest() {
    setBusy("suggest");
    setError(null);
    try {
      const r = await fetch("/api/chat/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyer_message: pending }),
      });
      const d = (await r.json()) as { source?: string; reply?: string; rule_name?: string; error?: string };
      if (!r.ok || !d.reply) throw new Error(d.error ?? "no suggestion");
      setDraft(d.reply);
      setDraftSource(d.source === "rule" ? `rule: ${d.rule_name}` : "AI draft — check before sending");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function sendReply() {
    setBusy("send");
    setError(null);
    try {
      const r = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: conv.shop_id, to_id: conv.to_id, text: draft }),
      });
      if (!r.ok) throw new Error(await r.text());
      setDraft("");
      setDraftSource(null);
      thread.reload();
      onSent();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
        <span className="font-medium">{conv.to_name ?? `Buyer ${conv.to_id}`}</span>
        <span className="text-sm">
          <ShopBadge shopId={conv.shop_id} name={conv.shop_name} />
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2 bg-gray-50">
        {thread.loading && !thread.data && <p className="text-sm text-gray-400">Loading…</p>}
        {thread.error && <p className="text-sm text-red-600">Error: {thread.error}</p>}
        {messages.map((m) => (
          <div key={m.message_id} className={`flex ${isSeller(m) ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-sm ${
                isSeller(m) ? "bg-shopee text-white rounded-br-sm" : "bg-white border border-gray-200 rounded-bl-sm"
              }`}
            >
              {m.content.text ?? <span className="italic opacity-70">[{m.message_type}]</span>}
              <div className={`text-[10px] mt-1 ${isSeller(m) ? "text-white/70" : "text-gray-400"}`}>
                {timeLabel(m.created_timestamp)}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <div className="border-t border-gray-200 p-3 space-y-2">
        {error && <p className="text-sm text-red-600 break-words">{error}</p>}
        {draftSource && <p className="text-xs text-gray-500">{draftSource}</p>}
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (!e.target.value) setDraftSource(null);
          }}
          placeholder={`Reply as ${conv.shop_name}…`}
          rows={3}
          className="w-full p-2 border border-gray-200 rounded-md text-sm"
        />
        <div className="flex justify-between">
          <button
            onClick={suggest}
            disabled={!!busy || !pending}
            title={pending ? "Draft a reply to the buyer's latest messages" : "Nothing new from the buyer"}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-gray-300 disabled:opacity-50"
          >
            <Sparkles size={14} /> {busy === "suggest" ? "Thinking…" : "Suggest reply"}
          </button>
          <button
            onClick={sendReply}
            disabled={!!busy || !draft.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-md bg-shopee text-white disabled:opacity-50"
          >
            <Send size={14} /> {busy === "send" ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
