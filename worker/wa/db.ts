/** Tiny helpers shared by the worker's Supabase writers. */
import { supabase } from "../../lib/supabase.js";

const FILTER_CHUNK = 100; // values per `in (...)` filter, to stay well under URL limits

/** Unwrap a supabase-js result, throwing its error. */
export function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/** Split for bulk writes and `in (...)` filters (PostgREST puts filters in the URL, which has a length limit). */
export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Rows of one account whose `column` is any of `values`, fetched in URL-safe chunks. */
export async function selectIn<R>(table: string, accountId: string, column: string, values: string[], columns = "*"): Promise<R[]> {
  const out: R[] = [];
  for (const part of chunks([...new Set(values)], FILTER_CHUNK)) {
    const rows = check(await supabase.from(table).select(columns).eq("account_id", accountId).in(column, part));
    out.push(...((rows ?? []) as R[]));
  }
  return out;
}
