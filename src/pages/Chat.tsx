import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, FileText, Sparkles, Send } from "lucide-react";
import { useShopParam, useShops } from "../lib/shops";
import { errorText, readJson, useFetch, usePoll, type ShopList } from "../lib/useFetch";
import { formatDayLabel, formatListTime, formatShopName, formatTime } from "../lib/format";
import { ShopBadge, ShopErrors, useMultiShop } from "../components/Shop";
import { PageHeader, RefreshButton } from "../components/Page";
import { ErrorNotice, Loading } from "../components/States";

interface Conversation {
  id: string;
  peer_id: string;
  peer_name: string | null;
  unread: number;
  last_text: string | null;
  last_at: number | null; // epoch ms
}

interface Message {
  id: string;
  from: "shop" | "customer";
  type: string;
  text: string | null;
  url: string | null; // media file, when viewable
  filename: string | null;
  at: number; // epoch ms
}

/** The file of a media message, or a placeholder when it can't be shown (e.g. from history sync). */
function Media({ m, url }: { m: Message; url: string | null }) {
  if (m.type === "text") return null;
  if (!url) return <span className="italic opacity-70">[{m.type}]</span>;
  if (m.type === "image" || m.type === "sticker")
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={m.filename ?? m.type} loading="lazy" className={`rounded-lg ${m.type === "sticker" ? "w-32" : "max-h-72"}`} />
      </a>
    );
  if (m.type === "video") return <video src={url} controls preload="metadata" className="rounded-lg max-h-72" />;
  if (m.type === "audio") return <audio src={url} controls preload="metadata" className="max-w-full" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="underline break-all">
      <FileText size={14} aria-hidden className="inline -mt-0.5 mr-1" />
      {m.filename ?? "Document"}
    </a>
  );
}

const MEDIA_PREVIEW: Record<string, string> = {
  image: "Photo",
  sticker: "Sticker",
  video: "Video",
  audio: "Voice message",
  document: "Document",
};
/** "[image]" → "Photo" in the list preview (display only). */
function preview(text: string | null): string {
  if (!text) return "…";
  const m = /^\[(\w+)\]$/.exec(text.trim());
  return m ? (MEDIA_PREVIEW[m[1]!] ?? text) : text;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const convKey = (c: { shop_id: string; id: string }) => `${c.shop_id}:${c.id}`;
const peerName = (c: Conversation) => c.peer_name ?? `Customer ${c.peer_id}`;

export default function ChatPage() {
  const [shop] = useShopParam();
  const multi = useMultiShop();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useFetch<ShopList<Conversation>>(
    `/api/chat/conversations?shop=${shop}&type=${unreadOnly ? "unread" : "all"}`,
  );
  usePoll(list.reload, 15_000);
  const [selected, setSelected] = useState<string | null>(null);
  // Below md the list is display:none while a thread is open, which drops its scroll offset; restore it on Back.
  const listScroller = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  useLayoutEffect(() => {
    if (!selected && listScroller.current) listScroller.current.scrollTop = savedScroll.current;
  }, [selected]);
  const open = (key: string) => {
    savedScroll.current = listScroller.current?.scrollTop ?? 0;
    setSelected(key);
  };
  const conv = list.data?.items.find((c) => convKey(c) === selected) ?? null;

  const totalUnread = list.data?.items.reduce((s, c) => s + c.unread, 0) ?? 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Chat"
        subtitle={totalUnread > 0 ? `${totalUnread} unread` : undefined}
        actions={<RefreshButton onClick={list.reload} loading={list.loading && !!list.data} />}
      />
      <ShopErrors errors={list.data?.errors} />
      {list.error && <ErrorNotice error={list.error} onRetry={list.reload} />}

      <div className="flex flex-1 min-h-0 panel overflow-hidden">
        {/* Conversation list — below md it's the whole pane until a conversation is picked */}
        <div className={`${conv ? "hidden md:flex" : "flex"} w-full md:w-80 shrink-0 md:border-r border-gray-200 flex-col min-w-0`}>
          <div className="p-2 border-b border-gray-100">
            <div className="flex gap-1 bg-gray-100 rounded-md p-1" role="group" aria-label="Show">
              {[false, true].map((u) => (
                <button
                  key={String(u)}
                  type="button"
                  onClick={() => setUnreadOnly(u)}
                  aria-pressed={unreadOnly === u}
                  className={`flex-1 py-1.5 rounded text-sm ${
                    unreadOnly === u ? "bg-white shadow-sm font-medium text-gray-900" : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {u ? "Unread" : "All"}
                </button>
              ))}
            </div>
          </div>
          <div ref={listScroller} className="flex-1 overflow-y-auto">
            {list.loading && !list.data && <Loading bare />}
            {list.data && !list.data.items.length && (
              <p className="p-4 text-sm text-gray-500">{unreadOnly ? "No unread chats." : "No conversations yet."}</p>
            )}
            {list.data?.items.map((c) => (
              <button
                key={convKey(c)}
                type="button"
                onClick={() => open(convKey(c))}
                aria-current={selected === convKey(c) ? "true" : undefined}
                className={`w-full text-left px-4 py-3 border-b border-gray-100 ${
                  selected === convKey(c) ? "bg-shopee-50" : "hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate ${c.unread ? "font-semibold" : ""}`}>{peerName(c)}</span>
                  <span className="text-xs text-gray-600 shrink-0 tabular-nums">{formatListTime(c.last_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-sm text-gray-600 truncate">{preview(c.last_text)}</span>
                  {c.unread > 0 && (
                    <span className="text-xs bg-shopee-600 text-white rounded-full px-1.5 min-w-5 text-center shrink-0 tabular-nums">
                      {c.unread}
                      <span className="sr-only"> unread</span>
                    </span>
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
          <Thread key={convKey(conv)} conv={conv} onSent={list.reload} onBack={() => setSelected(null)} />
        ) : (
          <div className="hidden md:flex flex-1 items-center justify-center text-sm text-gray-500">Pick a conversation</div>
        )}
      </div>
    </div>
  );
}

function Thread({
  conv,
  onSent,
  onBack,
}: {
  conv: Conversation & { shop_id: string; shop_name: string };
  onSent: () => void;
  onBack: () => void;
}) {
  const shops = useShops();
  const shopName = formatShopName({ platform: shops.find((s) => s.id === conv.shop_id)?.platform, shop_name: conv.shop_name });
  const thread = useFetch<{ messages: Message[] }>(
    `/api/chat/messages?shop_id=${conv.shop_id}&conversation_id=${encodeURIComponent(conv.id)}`,
  );
  usePoll(thread.reload, 10_000);
  const [draft, setDraft] = useState("");
  const [draftSource, setDraftSource] = useState<string | null>(null);
  const [busy, setBusy] = useState<"suggest" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Each poll returns freshly signed media URLs; keep the first one per message so files don't reload every 10s.
  const mediaUrls = useRef(new Map<string, string>());
  const urlOf = (m: Message) => {
    if (m.url && !mediaUrls.current.has(m.id)) mediaUrls.current.set(m.id, m.url);
    return mediaUrls.current.get(m.id) ?? null;
  };

  const messages = [...(thread.data?.messages ?? [])].sort((a, b) => a.at - b.at);
  const isSeller = (m: Message) => m.from === "shop";

  // Scroll only the messages pane: scrollIntoView() would also scroll the page and hide the headers.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // The buyer's latest unanswered messages — what a reply should respond to.
  const lastSeller = messages.map(isSeller).lastIndexOf(true);
  const pending = messages.slice(lastSeller + 1).map((m) => m.text).filter(Boolean).join("\n");

  async function suggest() {
    setBusy("suggest");
    setError(null);
    try {
      const r = await fetch("/api/chat/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyer_message: pending }),
      });
      const d = await readJson<{ source?: string; reply?: string; rule_name?: string; error?: string }>(r);
      if (!r.ok || !d.reply) throw new Error(d.error ?? "no suggestion");
      setDraft(d.reply);
      setDraftSource(d.source === "rule" ? `rule: ${d.rule_name}` : "AI draft — check before sending");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function sendReply() {
    if (busy || !draft.trim()) return;
    setBusy("send");
    setError(null);
    try {
      const r = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: conv.shop_id, conversation_id: conv.id, peer_id: conv.peer_id, text: draft }),
      });
      if (!r.ok) throw new Error(await r.text());
      setDraft("");
      setDraftSource(null);
      thread.reload();
      onSent();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const keyHint = isMac ? "⌘↵" : "Ctrl ↵";
  const aiMissing = !!error && /API_KEY|api key/i.test(error);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-3 md:px-5 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 shrink-0 max-w-[60%] md:max-w-none md:shrink">
          <button type="button" onClick={onBack} className="btn-icon md:hidden shrink-0" aria-label="Back to conversations">
            <ArrowLeft size={16} aria-hidden />
          </button>
          <span className="font-medium truncate">{peerName(conv)}</span>
        </div>
        {/* The customer's name wins the space: below sm the badge drops the platform word (the icon stays) and truncates. */}
        <span className="text-sm min-w-0 flex sm:hidden">
          <ShopBadge shopId={conv.shop_id} name={conv.shop_name} />
        </span>
        <span className="text-sm shrink-0 hidden sm:inline">
          <ShopBadge shopId={conv.shop_id} name={conv.shop_name} showPlatform />
        </span>
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto px-3 md:px-5 py-4 space-y-2 bg-gray-50">
        {thread.loading && !thread.data && <Loading bare />}
        {thread.error && <ErrorNotice error={thread.error} onRetry={thread.reload} />}
        {thread.data && !messages.length && (
          <p className="text-sm text-gray-500 text-center py-8">No messages in this chat yet.</p>
        )}
        {messages.map((m, i) => {
          const day = formatDayLabel(m.at);
          const newDay = i === 0 || formatDayLabel(messages[i - 1]!.at) !== day;
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div role="separator" className="flex items-center gap-3 my-3 text-xs text-gray-500">
                  <span className="flex-1 h-px bg-gray-200" />
                  {day}
                  <span className="flex-1 h-px bg-gray-200" />
                </div>
              )}
              <div className={`flex ${isSeller(m) ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-3.5 py-2 text-sm break-words ${
                    isSeller(m) ? "bg-shopee-600 text-white rounded-br-sm" : "bg-white border border-gray-200 rounded-bl-sm"
                  }`}
                >
                  <Media m={m} url={urlOf(m)} />
                  {m.text && <div className={`whitespace-pre-wrap ${m.type === "text" ? "" : "mt-1"}`}>{m.text}</div>}
                  {!m.text && m.type === "text" && <span className="italic opacity-70">[empty]</span>}
                  <div className={`text-[11px] mt-1 tabular-nums ${isSeller(m) ? "text-white" : "text-gray-500"}`}>
                    {formatTime(m.at)}
                  </div>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      <div className="border-t border-gray-200 p-3 space-y-2">
        {error && (
          <p role="alert" className="text-sm text-red-700 break-words">
            {aiMissing ? (
              <>
                AI replies aren't set up: {error}. See{" "}
                <Link to="/dashboard/settings" className="link">
                  Settings
                </Link>
                .
              </>
            ) : (
              error
            )}
          </p>
        )}
        {draftSource && <p className="text-xs text-gray-500">{draftSource}</p>}
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (!e.target.value) setDraftSource(null);
          }}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter sends; plain Enter is a newline (no accidental sends from a business number).
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void sendReply();
            }
          }}
          aria-label="Reply"
          placeholder={`Reply as ${shopName}…`}
          rows={3}
          className="input w-full resize-none"
        />
        <div className="flex justify-between gap-2">
          <button
            type="button"
            onClick={suggest}
            disabled={!!busy || !pending}
            title={pending ? "Draft a reply to the buyer's latest messages" : "Nothing new from the buyer"}
            className="btn-secondary"
          >
            <Sparkles size={14} aria-hidden /> {busy === "suggest" ? "Thinking…" : "Suggest reply"}
          </button>
          <button
            type="button"
            onClick={() => void sendReply()}
            disabled={!!busy || !draft.trim()}
            title="Send (⌘/Ctrl + Enter)"
            className="btn-primary px-4"
          >
            <Send size={14} aria-hidden /> {busy === "send" ? "Sending…" : "Send"}
            <kbd className="hidden sm:inline font-sans text-[11px] ml-1">{keyHint}</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
