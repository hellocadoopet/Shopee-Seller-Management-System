import { useEffect, useState } from "react";

type Provider = "claude" | "openai" | "deepseek";

const LABELS: Record<Provider, string> = {
  claude: "Claude (Anthropic)",
  openai: "ChatGPT (OpenAI)",
  deepseek: "DeepSeek",
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<{ provider: Provider; model: string; hasKey: boolean; keyEnv: string } | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {});
  }, []);

  async function test() {
    setBusy(true);
    setTestResult(null);
    try {
      const r = await fetch("/api/settings/test", { method: "POST" });
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
      <p className="text-sm text-gray-500 mb-6">Which AI writes your chat replies.</p>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3 text-sm">
        <div>
          <span className="text-gray-500">Provider:</span>{" "}
          <b>{settings ? LABELS[settings.provider] : "…"}</b>
        </div>
        <div>
          <span className="text-gray-500">Model:</span> <span className="font-mono">{settings?.model ?? "…"}</span>
        </div>
        <div>
          <span className="text-gray-500">API key</span> <span className="font-mono">({settings?.keyEnv ?? "…"})</span>:{" "}
          {settings?.hasKey ? <span className="text-green-600">set</span> : <span className="text-red-600">missing</span>}
        </div>
        <button
          onClick={test}
          disabled={busy}
          className="mt-2 px-4 py-2 rounded-md border border-gray-300 disabled:opacity-50"
        >
          {busy ? "…" : "Test connection"}
        </button>
        {testResult && (
          <p className={testResult.startsWith("✓") ? "text-green-600" : "text-red-600"}>{testResult}</p>
        )}
      </div>

      <div className="mt-6 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-4">
        To switch AI, set <code>LLM_PROVIDER</code> (claude / openai / deepseek) and that provider's key
        (<code>ANTHROPIC_API_KEY</code>, <code>OPENAI_API_KEY</code>, <code>DEEPSEEK_API_KEY</code>) — optionally{" "}
        <code>LLM_MODEL</code> — in the environment (Vercel → Settings → Environment Variables), then
        redeploy. Chat reply rules and tone examples live in <code>config/chatbot.json</code>.
      </div>
    </div>
  );
}
