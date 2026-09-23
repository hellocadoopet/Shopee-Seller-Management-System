import { useEffect, useState } from "react";

type Provider = "claude" | "openai" | "deepseek";

const LABELS: Record<Provider, string> = {
  claude: "Claude (Anthropic)",
  openai: "ChatGPT (OpenAI)",
  deepseek: "DeepSeek",
};

const DEFAULT_MODEL: Record<Provider, string> = {
  claude: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  deepseek: "deepseek-chat",
};

const KEY_HELP: Record<Provider, string> = {
  claude: "Get a key at console.anthropic.com → API Keys",
  openai: "Get a key at platform.openai.com → API keys",
  deepseek: "Get a key at platform.deepseek.com → API keys",
};

export default function SettingsPage() {
  const [provider, setProvider] = useState<Provider>("claude");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: { provider: Provider; model: string; hasKey: boolean }) => {
        setProvider(d.provider);
        setModel(d.model);
        setHasKey(d.hasKey);
      })
      .catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model, api_key: apiKey || undefined }),
      });
      if (!r.ok) throw new Error(await r.text());
      setStatus("Saved ✓");
      setApiKey("");
      setHasKey(true);
    } catch (e) {
      setStatus("Failed: " + String(e));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setTestResult(null);
    try {
      const r = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model, api_key: apiKey || undefined }),
      });
      const d = (await r.json()) as { ok: boolean; reply?: string; error?: string };
      setTestResult(d.ok ? `✓ Working — AI replied: "${d.reply}"` : `✗ ${d.error}`);
    } catch (e) {
      setTestResult("✗ " + String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-2">Settings</h1>
      <p className="text-sm text-gray-500 mb-6">
        Choose which AI writes your chat replies, and connect it with an API key.
      </p>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1">AI provider</label>
          <select
            value={provider}
            onChange={(e) => {
              const p = e.target.value as Provider;
              setProvider(p);
              setModel(DEFAULT_MODEL[p]);
            }}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            {(Object.keys(LABELS) as Provider[]).map((p) => (
              <option key={p} value={p}>
                {LABELS[p]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Model</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={DEFAULT_MODEL[provider]}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
          />
          <p className="text-xs text-gray-400 mt-1">
            Leave as default unless you know a specific model name.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            API key {hasKey && <span className="text-green-600 text-xs">(a key is already saved)</span>}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasKey ? "•••••••• (leave blank to keep current)" : "Paste your API key"}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
          />
          <p className="text-xs text-gray-400 mt-1">{KEY_HELP[provider]}</p>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={save}
            disabled={busy}
            className="px-4 py-2 rounded-md bg-shopee text-white text-sm disabled:opacity-50"
          >
            {busy ? "…" : "Save"}
          </button>
          <button
            onClick={test}
            disabled={busy}
            className="px-4 py-2 rounded-md border border-gray-300 text-sm disabled:opacity-50"
          >
            Test connection
          </button>
        </div>

        {status && <p className="text-sm text-gray-600">{status}</p>}
        {testResult && (
          <p className={`text-sm ${testResult.startsWith("✓") ? "text-green-600" : "text-red-600"}`}>
            {testResult}
          </p>
        )}
      </div>

      <div className="mt-6 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-4">
        <b>Note:</b> These AI services use an <b>API key</b>, not a login. There is no
        "Sign in with ChatGPT" for generating replies — you paste a secret key from the provider's
        website. Your key is encrypted before it's stored.
      </div>
    </div>
  );
}
