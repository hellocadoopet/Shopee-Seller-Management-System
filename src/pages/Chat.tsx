import { useState } from "react";

export default function ChatPage() {
  const [buyerMessage, setBuyerMessage] = useState("");
  const [suggestion, setSuggestion] = useState<{ source: string; reply: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function suggest() {
    if (!buyerMessage.trim()) return;
    setBusy(true);
    const res = await fetch("/api/chat/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buyer_message: buyerMessage }),
    });
    const data = await res.json();
    setSuggestion(data);
    setBusy(false);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Chat reply assistant</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <label className="text-sm text-gray-600">Buyer's message:</label>
        <textarea
          value={buyerMessage}
          onChange={(e) => setBuyerMessage(e.target.value)}
          placeholder="Paste what the buyer said here…"
          className="w-full p-2 border border-gray-200 rounded-md text-sm mt-1"
          rows={3}
        />
        <button
          onClick={suggest}
          disabled={busy || !buyerMessage.trim()}
          className="mt-2 px-4 py-2 bg-shopee text-white text-sm rounded-md disabled:opacity-50"
        >
          {busy ? "Thinking…" : "Suggest a reply"}
        </button>
      </div>

      {suggestion && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs uppercase text-gray-500 mb-1">From: {suggestion.source}</div>
          <p className="text-gray-800">{suggestion.reply}</p>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-6">
        For full live chat (browse conversations + send replies), we'll add the conversation list
        UI next. For now, this previews the rule-match + LLM reply logic.
      </p>
    </div>
  );
}
