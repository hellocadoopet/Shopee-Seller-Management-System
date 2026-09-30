import { useState } from "react";
import { errorText, readJson, useFetch } from "../lib/useFetch";
import { PageHeader } from "../components/Page";
import { ErrorNotice, Loading } from "../components/States";

type Provider = "claude" | "openai" | "deepseek";

const LABELS: Record<Provider, string> = {
  claude: "Claude (Anthropic)",
  openai: "ChatGPT (OpenAI)",
  deepseek: "DeepSeek",
};

export default function SettingsPage() {
  const { data: settings, error, loading, reload } = useFetch<{ provider: Provider; model: string; hasKey: boolean; keyEnv: string }>(
    "/api/settings",
  );
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function test() {
    setBusy(true);
    setTestResult(null);
    try {
      const r = await fetch("/api/settings/test", { method: "POST" });
      const d = await readJson<{ ok: boolean; reply?: string; error?: string }>(r);
      setTestResult(d.ok ? { ok: true, text: `Working. The AI replied: "${d.reply}"` } : { ok: false, text: errorText(d.error) });
    } catch (e) {
      setTestResult({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" subtitle="Which AI drafts your chat replies." />
      {error && <ErrorNotice error={error} onRetry={reload} />}

      {loading && !settings ? (
        <Loading />
      ) : settings ? (
        <div className="panel p-6 text-sm">
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2">
            <dt className="text-gray-500">Provider</dt>
            <dd className="font-medium">{LABELS[settings.provider] ?? settings.provider}</dd>
            <dt className="text-gray-500">Model</dt>
            <dd className="font-mono break-all">{settings.model}</dd>
            <dt className="text-gray-500">API key</dt>
            <dd>
              <span className="font-mono break-all">{settings.keyEnv}</span>:{" "}
              {settings.hasKey ? <span className="text-green-700">Set</span> : <span className="text-red-700 font-medium">Missing</span>}
            </dd>
          </dl>
          {!settings.hasKey && (
            <p className="mt-3 text-gray-700">
              Suggest reply in Chat won't work until <code className="break-all">{settings.keyEnv}</code> is set.
            </p>
          )}
          <button type="button" onClick={test} disabled={busy} className="btn-secondary mt-4">
            {busy ? "Testing…" : "Test connection"}
          </button>
          {testResult && (
            <p role={testResult.ok ? "status" : "alert"} className={`mt-3 break-words ${testResult.ok ? "text-green-700" : "text-red-700"}`}>
              {testResult.text}
            </p>
          )}
        </div>
      ) : null}

      <div className="mt-6 text-xs text-gray-500 bg-white border border-gray-200 rounded-xl p-4 break-words">
        To switch AI, set <code className="break-all">LLM_PROVIDER</code> (claude / openai / deepseek) and that provider's key (
        <code className="break-all">ANTHROPIC_API_KEY</code>, <code className="break-all">OPENAI_API_KEY</code>,{" "}
        <code className="break-all">DEEPSEEK_API_KEY</code>), optionally <code className="break-all">LLM_MODEL</code>, on the Railway
        api service (Variables tab), then deploy the staged change. Chat reply rules and tone examples live in{" "}
        <code className="break-all">config/chatbot.json</code>.
      </div>
    </div>
  );
}
