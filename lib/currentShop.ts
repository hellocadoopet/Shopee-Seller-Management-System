import { supabase } from "./supabase";

export const CURRENT_SHOP_COOKIE = "current_shop_id";

/** Active shop UUID from the cookie value, or fall back to the most recently connected shop. */
export async function getCurrentShopId(fromCookie: string | undefined): Promise<string | null> {
  if (fromCookie) return fromCookie;

  const { data } = await supabase
    .from("shops")
    .select("id")
    .is("disconnected_at", null)
    .order("connected_at", { ascending: false })
    .limit(1);
  return data?.[0]?.id ?? null;
}
