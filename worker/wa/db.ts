/** Tiny helpers shared by the worker's Supabase writers. */

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
