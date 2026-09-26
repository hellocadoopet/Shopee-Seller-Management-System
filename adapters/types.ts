/**
 * The contract every platform (Shopee, WhatsApp, …) implements.
 *
 * Routes and pages only ever see the domain models below — never a platform's raw API shapes —
 * so adding a platform means adding an adapter under adapters/<platform>/, not touching the server.
 *
 * Platforms differ in what they can do (WhatsApp has chat but no catalog), so each capability is
 * optional. Callers ask the factory for a capability and skip shops whose platform lacks it.
 */

export type PlatformId = "shopee" | "whatsapp";

/** A connected account on a platform: a Shopee shop, a WhatsApp business number, … */
export interface Shop {
  id: string; // our UUID
  platform: PlatformId;
  external_id: string; // the platform's own id (Shopee shop_id, WhatsApp phone_number_id)
  shop_name: string;
}

/** What an adapter gets to call the platform for one shop. The token is decrypted and fresh. */
export interface Credentials {
  externalId: string;
  accessToken: string;
}

/** Tokens as a platform issues them. Absent fields mean "doesn't apply on this platform". */
export interface IssuedTokens {
  accessToken: string;
  expiresIn?: number; // seconds until the access token expires
  refreshToken?: string;
  refreshExpiresIn?: number; // seconds until the refresh token expires
}

// ─────────────────────────────────────────────────────────────
// Domain models. Ids are strings (platforms disagree on numeric vs string); times are epoch ms.
// ─────────────────────────────────────────────────────────────

export interface Product {
  id: string;
  name: string;
  sku: string;
  status: string;
  has_variants: boolean;
  price: number | null; // null for variant products (price lives on each variant)
  stock: number | null;
}

export interface OrderLine {
  product_id: string;
  name: string;
  qty: number;
  unit_price: number; // what the buyer paid per unit, after discounts
}

export interface Order {
  id: string;
  status: string; // the platform's own status label, for display
  counts_as_sale: boolean; // false for unpaid / cancelled — the adapter decides what that means
  total: number;
  currency: string;
  buyer_name: string | null;
  created_at: number;
  lines: OrderLine[];
}

export interface Conversation {
  id: string;
  peer_id: string; // who a reply is addressed to
  peer_name: string | null;
  unread: number;
  last_text: string | null;
  last_at: number | null;
}

export interface Message {
  id: string;
  from: "shop" | "customer";
  type: string; // "text", "image", "sticker", …
  text: string | null;
  url: string | null;
  at: number;
}

export interface Voucher {
  id: string;
  code: string;
  name: string;
  percentage: number | null; // set for percentage-off vouchers…
  amount: number | null; // …or a fixed amount off
  starts_at: number;
  ends_at: number;
}

export interface AdReport {
  campaign_id: string;
  campaign_name: string;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  spend: number | null;
  gmv: number | null;
  roas: number | null;
}

// ─────────────────────────────────────────────────────────────
// Capabilities
// ─────────────────────────────────────────────────────────────

/** OAuth-style "click Connect, authorize on the platform, come back" flow. */
export interface ConnectCapability {
  /** URL the seller visits to authorize us. `state` must come back in the callback query. */
  authorizeUrl(state: string): string;
  /** Turn the callback query into a connected shop plus its tokens. */
  completeAuthorization(query: Record<string, string>): Promise<{ externalId: string; name: string | null; tokens: IssuedTokens }>;
  /** Swap a refresh token for new tokens. Omitted by platforms whose tokens don't expire. */
  refresh?(refreshToken: string, externalId: string): Promise<IssuedTokens>;
}

export interface CatalogCapability {
  list(creds: Credentials): Promise<Product[]>;
  /** Writes to the live platform. */
  updatePrice(creds: Credentials, productId: string, price: number): Promise<void>;
}

export interface OrdersCapability {
  /** Orders created from `since` until now. */
  list(creds: Credentials, since: Date): Promise<Order[]>;
}

export interface ChatCapability {
  /** One page of conversations, newest first. `next` feeds the following call; null = no more. */
  listConversations(
    creds: Credentials,
    opts: { unreadOnly: boolean; cursor?: string },
  ): Promise<{ conversations: Conversation[]; next: string | null }>;
  listMessages(creds: Credentials, conversationId: string): Promise<Message[]>;
  /** Sends a real message to a real customer. */
  send(creds: Credentials, to: { conversationId: string; peerId: string }, text: string): Promise<void>;
}

export interface PromotionsCapability {
  listVouchers(creds: Credentials): Promise<Voucher[]>;
}

export interface AdsCapability {
  /** Dates are YYYY-MM-DD. */
  report(creds: Credentials, range: { start: string; end: string }): Promise<AdReport[]>;
}

export interface WebhookRequest {
  url: string;
  body: string;
  header(name: string): string | undefined;
}

export interface WebhookCapability {
  /** Answer the platform's GET subscription check, if it does one. Null = reject. */
  challenge?(query: Record<string, string>): string | null;
  /** True only if the request provably came from the platform. */
  verify(req: WebhookRequest): boolean;
  /** Called only after verify() passed. */
  handle(body: string): Promise<void>;
}

export interface PlatformAdapter {
  id: PlatformId;
  label: string;
  /** Names of required env vars that are missing; empty = ready to use. */
  missingConfig(): string[];
  connect?: ConnectCapability;
  catalog?: CatalogCapability;
  orders?: OrdersCapability;
  chat?: ChatCapability;
  promotions?: PromotionsCapability;
  ads?: AdsCapability;
  webhook?: WebhookCapability;
}

export type Capability = "connect" | "catalog" | "orders" | "chat" | "promotions" | "ads" | "webhook";

export const CAPABILITIES: Capability[] = ["connect", "catalog", "orders", "chat", "promotions", "ads", "webhook"];

/** A platform refused an operation it doesn't support (as opposed to failing at it). */
export class NotSupportedError extends Error {
  constructor(platform: PlatformId, what: string) {
    super(`${platform}: ${what} is not supported`);
    this.name = "NotSupportedError";
  }
}
