import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

/** Same header on every dashboard page: title, optional subtitle (period), actions on the right. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** The one refresh control. Spins while a reload is in flight. */
export function RefreshButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="btn-icon" aria-label="Refresh" title="Refresh">
      <RefreshCw size={16} aria-hidden className={loading ? "animate-spin motion-reduce:animate-none" : ""} />
    </button>
  );
}
