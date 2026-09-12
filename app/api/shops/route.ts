import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/** List all connected shops. */
export async function GET() {
  const { data, error } = await supabase
    .from("shops")
    .select("id, shopee_shop_id, shop_name, region, connected_at")
    .is("disconnected_at", null)
    .order("connected_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shops: data ?? [] });
}
