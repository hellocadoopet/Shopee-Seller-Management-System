import { useState } from "react";
import { errorText } from "../lib/useFetch";

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
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="max-w-sm w-full bg-white rounded-xl border border-gray-200 p-6 sm:p-8">
        <h1 className="text-xl font-semibold mb-1 text-shopee">Shopee Solo</h1>
        <p className="text-sm text-gray-500 mb-6">Enter the password to continue.</p>
        <label htmlFor="password" className="sr-only">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="input w-full py-2 mb-3"
        />
        {error && (
          <p role="alert" className="text-red-700 text-sm mb-3">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !password}
          className="btn-primary w-full py-2.5"
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </main>
  );
}
