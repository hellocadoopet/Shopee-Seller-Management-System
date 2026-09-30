import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { errorText, useFetch } from "../lib/useFetch";

interface Platform {
  id: string;
  label: string;
  connect_via: "oauth" | "pairing" | null;
  connectable: boolean;
  missing_config: string[];
}

export default function ConnectPage() {
  useEffect(() => {
    document.title = "Connect a shop · Shopee Solo";
  }, []);
  const error = useSearchParams()[0].get("error");
  const { data, error: loadError } = useFetch<{ platforms: Platform[] }>("/api/platforms");
  const platforms = data?.platforms ?? [];

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-xl border border-gray-200 p-6 sm:p-8 text-center">
        <h1 className="text-2xl font-semibold mb-2">Connect a shop</h1>
        <p className="text-sm text-gray-600 mb-6">
          Marketplaces redirect you to authorize this app; WhatsApp links like WhatsApp Web, by scanning a QR code.
          You can revoke access anytime from the platform (or WhatsApp → Linked devices).
        </p>
        <div className="space-y-3">
          {platforms.map((p) =>
            p.connectable && p.connect_via === "pairing" ? (
              <Link key={p.id} to={`/connect/${p.id}`} className="btn-primary w-full py-3">
                Link {p.label} by QR code
              </Link>
            ) : p.connectable ? (
              // Plain anchor — the server-side redirect handles everything
              <a key={p.id} href={`/api/${p.id}/authorize`} className="btn-primary w-full py-3">
                Authorize with {p.label}
              </a>
            ) : (
              <div key={p.id} className="w-full py-3 px-3 rounded-md border border-gray-200 text-gray-500 text-sm break-words">
                {p.label}: {p.missing_config.length ? `not set up on this server (${p.missing_config.join(", ")})` : "coming soon"}
              </div>
            ),
          )}
        </div>
        {(error || loadError) && (
          <p role="alert" className="mt-4 text-sm text-red-700 break-words text-left">
            {error ? errorText(error) : loadError}
          </p>
        )}
      </div>
    </main>
  );
}
