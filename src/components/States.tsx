import type { ReactNode } from "react";
import { Link } from "react-router";
import { Loader2, Store, type LucideIcon } from "lucide-react";

/** First-load indicator. Sits under the page header, in place of the content. `bare` = no panel (inside a pane). */
export function Loading({ label = "Loading…", bare }: { label?: string; bare?: boolean }) {
  return (
    <div
      role="status"
      className={`${bare ? "" : "panel "}py-12 flex items-center justify-center gap-2 text-sm text-gray-500`}
    >
      <Loader2 size={16} aria-hidden className="animate-spin motion-reduce:animate-none" />
      {label}
    </div>
  );
}

/** A request failed. `error` must already be readable text (errorText). */
export function ErrorNotice({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start justify-between gap-3 mb-4"
    >
      <span className="break-words min-w-0 py-1">Couldn't load: {error}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary py-1 shrink-0">
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon?: LucideIcon; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel px-6 py-12 text-center">
      {Icon && <Icon size={24} aria-hidden className="mx-auto text-gray-400" />}
      <p className={`text-sm font-medium text-gray-900 ${Icon ? "mt-3" : ""}`}>{title}</p>
      {body && <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** No shop in view has the capability this tab needs (e.g. only a WhatsApp number is connected). */
export function NeedsCapability({ what, providers }: { what: string; providers: string[] }) {
  const platform = providers.length ? providers.join(" or ") : "Shopee";
  const verb = what.endsWith("s") ? "need" : "needs";
  return (
    <EmptyState
      icon={Store}
      title={`${what} ${verb} a ${platform} shop`}
      body={`None of the shops in view can show ${what.toLowerCase()}. Connect a ${platform} shop to see them here.`}
      action={
        <Link to="/connect" className="btn-primary">
          Connect {platform}
        </Link>
      }
    />
  );
}
