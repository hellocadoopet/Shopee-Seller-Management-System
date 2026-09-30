/** One place for how numbers, money, times and shop names look. Null → "—" everywhere. */

const DASH = "—";
const LOCALE = "en-MY";

const money = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "RM 1,234.00"; other currencies keep their code ("USD 12.00"). */
export function formatMoney(n: number | null | undefined, currency = "MYR"): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const prefix = !currency || currency === "MYR" || currency === "RM" ? "RM" : currency;
  return `${prefix} ${money.format(n)}`;
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

/** Input is already a percent (Ads ctr). */
export function formatPercent(n: number | null | undefined, digits = 2): string {
  return n == null || !Number.isFinite(n) ? DASH : `${formatNumber(n, digits)}%`;
}

export function formatRatio(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? DASH : `${formatNumber(n, 2)}x`;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
// Built by hand: ICU's en-MY/en-GB print "Sept", the spec wants "25 Sep".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "25 Sep", plus the year when asked. */
const dayMonth = (d: Date, withYear: boolean) => `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ""}`;
const thisYear = (d: Date) => d.getFullYear() === new Date().getFullYear();

/** "6:41 PM" — no leading zero. */
export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
}

/** Conversation list: today → time; this year → "25 Sep"; older → "25 Sep 2025". */
export function formatListTime(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  if (sameDay(d, new Date())) return formatTime(ms);
  return dayMonth(d, !thisYear(d));
}

/** Day separators: "Today" / "Yesterday" / "Thu, 25 Sep" / "25 Sep 2025". */
export function formatDayLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (sameDay(d, now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  if (thisYear(d)) return `${DAYS[d.getDay()]}, ${dayMonth(d, false)}`;
  return dayMonth(d, true);
}

/** "25 Sep, 6:41 PM" (year added when it isn't this year). */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${dayMonth(d, !thisYear(d))}, ${formatTime(ms)}`;
}

/** "25 Sep 2026" */
export function formatShortDate(ms: number | null | undefined): string {
  if (!ms) return DASH;
  return dayMonth(new Date(ms), true);
}

/**
 * Display name for a shop. A WhatsApp number stored as bare digits reads as a phone number:
 * 60149863986 → "+60 14-986 3986", 601113066375 → "+60 11-1306 6375". Display only.
 */
export function formatShopName(shop: { platform?: string; shop_name: string }): string {
  const name = shop.shop_name;
  if (shop.platform !== "whatsapp" || !/^\d+$/.test(name)) return name;
  const my = /^60(1\d)(\d{7,8})$/.exec(name);
  if (my) {
    const [, prefix, rest] = my as unknown as [string, string, string];
    return `+60 ${prefix}-${rest.slice(0, rest.length - 4)} ${rest.slice(-4)}`;
  }
  return `+${name}`;
}

/** "READY_TO_SHIP" → "Ready to ship" */
export function humanize(raw: string): string {
  const s = raw.replace(/_/g, " ").toLowerCase().trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : raw;
}

type Tone = "green" | "amber" | "red" | "gray" | "blue";
const TONE_CLASS: Record<Tone, string> = {
  green: "bg-green-50 text-green-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-blue-50 text-blue-700",
};

const STATUS: Record<string, { label?: string; tone: Tone }> = {
  // products
  NORMAL: { label: "Live", tone: "green" },
  UNLIST: { label: "Unlisted", tone: "gray" },
  REVIEWING: { label: "In review", tone: "amber" },
  BANNED: { tone: "red" },
  SHOPEE_DELETE: { label: "Deleted by Shopee", tone: "red" },
  SELLER_DELETE: { label: "Deleted", tone: "red" },
  // orders
  UNPAID: { tone: "gray" },
  READY_TO_SHIP: { tone: "amber" },
  PROCESSED: { tone: "amber" },
  RETRY_SHIP: { tone: "amber" },
  SHIPPED: { tone: "blue" },
  TO_CONFIRM_RECEIVE: { label: "To confirm receipt", tone: "blue" },
  COMPLETED: { tone: "green" },
  IN_CANCEL: { label: "Cancelling", tone: "red" },
  CANCELLED: { tone: "red" },
  TO_RETURN: { label: "Return requested", tone: "red" },
};

/** Label + pill classes for a platform status (Products, Orders). Unknown → gray, humanised. */
export function statusTone(raw: string): { label: string; className: string } {
  const s = STATUS[raw];
  return { label: s?.label ?? humanize(raw), className: TONE_CLASS[s?.tone ?? "gray"] };
}
