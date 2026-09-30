import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import { errorText } from "../lib/useFetch";

interface PairingStatus {
  state: "starting" | "qr" | "connected" | "failed";
  qr?: string;
  shop_id?: string;
  reason?: string;
}

const POLL_MS = 2000; // QR codes rotate about every 20s; polling picks up each new one

/** Link a number by QR code, like WhatsApp Web: start → show the rotating QR → done when the phone scans it. */
export default function PairPage() {
  const platform = useParams().platform!;
  const [label, setLabel] = useState("");
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef<string | null>(null); // pairing to cancel if the user leaves mid-way

  async function start() {
    setError(null);
    setStatus({ state: "starting" });
    try {
      const r = await fetch(`/api/${platform}/pairings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const d = (await r.json()) as { pairing_id?: string; error?: string };
      if (!r.ok || !d.pairing_id) throw new Error(d.error ?? "couldn't start pairing");
      live.current = d.pairing_id;
      setPairingId(d.pairing_id);
    } catch (e) {
      setStatus(null);
      setError(errorText(e));
    }
  }

  useEffect(() => {
    if (!pairingId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/${platform}/pairings/${pairingId}`);
        const d = (await r.json()) as PairingStatus & { error?: string };
        if (!r.ok) throw new Error(d.error ?? r.statusText);
        if (stopped) return;
        setStatus(d);
        if (d.state === "connected") {
          live.current = null;
          window.location.assign(`/dashboard?shop=${d.shop_id}`); // full load so the new shop shows everywhere
          return;
        }
        if (d.state === "failed") {
          live.current = null;
          return;
        }
      } catch (e) {
        if (!stopped) setError(errorText(e));
      }
      if (!stopped) timer = window.setTimeout(poll, POLL_MS);
    };
    let timer = window.setTimeout(poll, 0);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [platform, pairingId]);

  // Leaving before the scan: release the half-made session on the worker.
  useEffect(
    () => () => {
      if (live.current) fetch(`/api/${platform}/pairings/${live.current}`, { method: "DELETE", keepalive: true }).catch(() => {});
    },
    [platform],
  );

  const failed = status?.state === "failed";

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-xl border border-gray-200 p-6 sm:p-8 text-center">
        <h1 className="text-2xl font-semibold mb-2">Link a WhatsApp number</h1>

        {!pairingId || failed ? (
          <>
            <p className="text-sm text-gray-600 mb-6">
              {failed ? status.reason ?? "Pairing failed." : "Give this number a name, then scan the QR code with that phone."}
            </p>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Name (optional), e.g. Cadoopet Sales"
              aria-label="Name for this number"
              className="input w-full py-2 mb-3"
            />
            <button
              onClick={() => {
                setPairingId(null);
                start();
              }}
              disabled={status?.state === "starting"}
              className="btn-primary w-full py-3"
            >
              {status?.state === "starting" ? "Starting…" : failed ? "Try again" : "Show QR code"}
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto my-4 w-64 h-64 flex items-center justify-center bg-gray-50 rounded-lg">
              {status?.qr ? (
                <img src={status.qr} alt="WhatsApp pairing QR code" className="w-64 h-64" />
              ) : (
                <span className="text-sm text-gray-500">{status?.state === "connected" ? "Linked! Opening…" : "Preparing QR code…"}</span>
              )}
            </div>
            <ol className="list-decimal pl-5 text-sm text-gray-600 text-left space-y-1 mb-2">
              <li>Open WhatsApp on the phone for this number</li>
              <li>Settings → Linked devices → Link a device</li>
              <li>Point the phone at this code</li>
            </ol>
            <p className="text-xs text-gray-500">The code refreshes on its own — keep this page open until it links.</p>
          </>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-700 break-words text-left">
            {error}
          </p>
        )}
        <Link to="/connect" className="inline-flex items-center gap-1 mt-6 text-sm text-gray-500 hover:underline">
          <ArrowLeft size={14} aria-hidden /> Back
        </Link>
      </div>
    </main>
  );
}
