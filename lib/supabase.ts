import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

// Service role bypasses RLS — only use server-side (Route Handlers).
export const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false },
});
