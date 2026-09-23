import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) {
        setError("Wrong password");
        setBusy(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next") || "/dashboard";
      window.location.href = next;
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="max-w-sm w-full bg-white rounded-2xl border border-gray-200 p-8">
        <h1 className="text-xl font-semibold mb-1 text-shopee">Shopee Solo</h1>
        <p className="text-sm text-gray-500 mb-6">Enter the password to continue.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm mb-3"
        />
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full py-2.5 rounded-lg bg-shopee text-white font-medium disabled:opacity-50"
        >
          {busy ? "…" : "Enter"}
        </button>
      </form>
    </main>
  );
}
