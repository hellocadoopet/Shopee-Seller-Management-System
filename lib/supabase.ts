import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config";

// Service role bypasses RLS — only use server-side.
// Created on first use so missing env fails that request, not the whole API process at import.
let client: SupabaseClient | undefined;

export const supabase = new Proxy({} as SupabaseClient, {
  get(_, key) {
    client ??= createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false },
    });
    const value = Reflect.get(client, key);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
