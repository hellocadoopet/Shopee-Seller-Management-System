import { useSearchParams } from "react-router";
import { useFetch } from "../lib/useFetch";

interface Platform {
  id: string;
  label: string;
  connectable: boolean;
  missing_config: string[];
}

export default function ConnectPage() {
  const error = useSearchParams()[0].get("error");
  const { data, error: loadError } = useFetch<{ platforms: Platform[] }>("/api/platforms");
  const platforms = data?.platforms ?? [];

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 p-8 text-center">
        <h1 className="text-2xl font-semibold mb-2">Connect a shop</h1>
        <p className="text-sm text-gray-600 mb-6">
          You'll be redirected to the platform to authorize this app to read your shop data and reply to chat.
          You can revoke access anytime from the platform's seller settings.
        </p>
        <div className="space-y-3">
          {platforms.map((p) =>
            p.connectable ? (
              // Plain anchor — the server-side redirect handles everything
              <a key={p.id} href={`/api/${p.id}/authorize`} className="block w-full py-3 rounded-lg bg-shopee text-white font-medium">
                Authorize with {p.label}
              </a>
            ) : (
              <div key={p.id} className="w-full py-3 rounded-lg border border-gray-200 text-gray-400 text-sm">
                {p.label} — {p.missing_config.length ? `set ${p.missing_config.join(", ")} first` : "coming soon"}
              </div>
            ),
          )}
        </div>
        {(error || loadError) && (
          <p className="mt-4 text-sm text-red-600 break-words text-left">Error: {error ?? loadError}</p>
        )}
      </div>
    </main>
  );
}
