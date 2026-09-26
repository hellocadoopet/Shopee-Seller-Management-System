/** shops + wa_accounts rows. The worker is the only writer of wa_accounts. */
import { supabase } from "../../lib/supabase.js";
import type { WaAccountStatus } from "../../adapters/whatsapp/contract.js";
import { check } from "./db.js";
import { serialize } from "./queue.js";

/**
 * A number finished pairing: its shops row first (wa_accounts.shop_id references it), then the
 * account. Upserts, so a retry after a half-finished attempt can't duplicate or conflict.
 */
export async function createPairedAccount(accountId: string, shopName: string, phoneNumber: string | null): Promise<string> {
  const now = new Date().toISOString();
  const shop = check(
    await supabase
      .from("shops")
      .upsert(
        { platform: "whatsapp", external_id: accountId, shop_name: shopName, connected_at: now, disconnected_at: null },
        { onConflict: "platform,external_id" },
      )
      .select("id")
      .single(),
  ) as { id: string };
  check(
    await supabase
      .from("wa_accounts")
      .upsert({ id: accountId, shop_id: shop.id, phone_number: phoneNumber, status: "connected", last_seen_at: now }, { onConflict: "id" }),
  );
  return shop.id;
}

/** Queued with the account's message writes so status updates land in order. */
export function setAccountStatus(accountId: string, status: WaAccountStatus): Promise<void> {
  return serialize(accountId, async () => {
    // last_seen_at = the last moment the socket was known alive.
    const patch = status === "connecting" || status === "logged_out" ? { status } : { status, last_seen_at: new Date().toISOString() };
    check(await supabase.from("wa_accounts").update(patch).eq("id", accountId));
  });
}

/** Accounts to reconnect on boot: everything not logged out. */
export async function listResumableAccounts(): Promise<Array<{ id: string; status: WaAccountStatus }>> {
  return check(await supabase.from("wa_accounts").select("id, status").neq("status", "logged_out")) ?? [];
}

export async function accountExists(accountId: string): Promise<boolean> {
  const row = check(await supabase.from("wa_accounts").select("id").eq("id", accountId).maybeSingle());
  return !!row;
}
