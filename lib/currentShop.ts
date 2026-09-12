import { cookies } from "next/headers";
import { supabase } from "./supabase";

const COOKIE_NAME = "current_shop_id";

/** Read the active shop UUID from cookie (or fall back to the first connected shop). */
export async function getCurrentShopId(): Promise<string | null> {
  const fromCookie = (await cookies()).get(COOKIE_NAME)?.value;
  if (fromCookie) return fromCookie;

  // Fall back: first active shop
  const { data } = await supabase
    .from("shops")
    .select("id")
    .is("disconnected_at", null)
    .order("connected_at", { ascending: false })
    .limit(1);
  return data?.[0]?.id ?? null;
}

export async function setCurrentShopId(shopId: string) {
  (await cookies()).set(COOKIE_NAME, shopId, {
    httpOnly: false, // client-side selector reads it
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}
