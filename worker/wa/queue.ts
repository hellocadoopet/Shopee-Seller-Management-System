/**
 * Per-account promise queue. supabase-js has no transactions and conversation aggregates are
 * read-then-write, so every DB write for one account runs strictly one after another.
 */
const tails = new Map<string, Promise<unknown>>();

export function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  tails.set(key, run);
  // Drop the entry once idle so the map doesn't grow with every account ever seen.
  void run.catch(() => {}).then(() => {
    if (tails.get(key) === run) tails.delete(key);
  });
  return run;
}

/** Resolves once everything queued for `key` so far has finished. */
export function drain(key: string): Promise<void> {
  return serialize(key, async () => {});
}
