/**
 * Platform factory — the only place that knows which adapters exist. To add a platform, build
 * adapters/<platform>/index.ts implementing PlatformAdapter and register it here.
 */
import { mockChat } from "./mock/chat.js";
import { shopee } from "./shopee/index.js";
import { whatsapp } from "./whatsapp/index.js";
import { CAPABILITIES, type Capability, type PlatformAdapter, type PlatformId } from "./types.js";

const REGISTRY: Record<PlatformId, PlatformAdapter> = { shopee, whatsapp };

/** MOCK_CHAT=true swaps every platform's chat for seeded dev data. Never set it in production. */
const useMockChat = () => process.env.MOCK_CHAT === "true";

export function isPlatform(id: string): id is PlatformId {
  return Object.hasOwn(REGISTRY, id);
}

export function getAdapter(platform: string): PlatformAdapter {
  if (!isPlatform(platform)) throw new Error(`Unknown platform: ${platform}`);
  const adapter = REGISTRY[platform];
  return useMockChat() && adapter.chat ? { ...adapter, chat: mockChat } : adapter;
}

/** A platform's implementation of `cap`, or null when that platform doesn't offer it. */
export function getCapability<K extends Capability>(platform: string, cap: K): NonNullable<PlatformAdapter[K]> | null {
  return getAdapter(platform)[cap] ?? null;
}

/** Every registered platform with what it can do — drives the Connect page. */
export function describePlatforms() {
  return (Object.keys(REGISTRY) as PlatformId[]).map((id) => {
    const adapter = getAdapter(id);
    const missing = adapter.missingConfig();
    return {
      id,
      label: adapter.label,
      capabilities: CAPABILITIES.filter((cap) => adapter[cap]),
      /** How a shop gets added: an OAuth redirect, or scanning a QR code on screen. */
      connect_via: adapter.connect ? "oauth" : adapter.pairing ? "pairing" : null,
      connectable: !!(adapter.connect || adapter.pairing) && missing.length === 0,
      missing_config: missing,
    };
  });
}
