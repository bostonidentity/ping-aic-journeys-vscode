/**
 * Map `items` through async `fn`, with at most `n` calls in flight at once.
 * Results are returned in input order. Throws on first rejection — matches
 * Promise.all semantics. Callers that need partial-failure behavior should
 * catch inside `fn` and return a tagged result type.
 *
 * Why we built this rather than depend on `p-limit`: it's 20 lines, has zero
 * external deps, and we want to keep the extension bundle lean. See
 * design-plan.md D16.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  n: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (n < 1) throw new Error(`mapConcurrent: concurrency must be >= 1, got ${n}`);
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(n, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
