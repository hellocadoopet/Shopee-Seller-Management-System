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

/** Numbers on a QR platform that lost their link — re-linking keeps their chats. */
function Relink({ platform, label }: { platform: string; label: string }) {
  const { data } = useFetch<{ shops: Array<{ shop_id: string; shop_name: string }> }>(`/api/${platform}/relinkable`);
  if (!data?.shops.length) return null;
  return (
    <div className="space-y-2 text-left">
      {data.shops.map((s) => (
        <div key={s.shop_id} className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="text-amber-900">
            <b>{s.shop_name}</b> is no longer linked — {label} messages aren't arriving.
          </p>
          <Link to={`/connect/${platform}?relink=${s.shop_id}`} className="btn-primary w-full py-2 mt-2">
            Re-link {s.shop_name} (keeps its chats)
          </Link>
        </div>
      ))}
    </div>
  );
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
              <div key={p.id} className="space-y-3">
                <Relink platform={p.id} label={p.label} />
                <Link to={`/connect/${p.id}`} className="btn-primary w-full py-3">
                  Link a new {p.label} number by QR code
                </Link>
              </div>
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
