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

/**
 * A shared concurrency limiter. Unlike `mapConcurrent` — which caps its
 * OWN pool per call — a `Limiter` caps total in-flight across every
 * `run()` call made against the same instance. Use it for multi-phase
 * walks where fan-out points nest: a single limiter threaded through all
 * phases keeps total concurrency at exactly `n` instead of letting nested
 * `mapConcurrent` calls multiply (see `docs/lessons.md` 2026-05-19).
 *
 * Each limiter is an independent instance — callers create their own per
 * logical operation; instances never share state (preserves D21's
 * three-independent-subsystems isolation).
 */
export interface Limiter {
  /** Run `task` once a concurrency slot is free. Resolves / rejects with
   * the task's result; a rejection frees the slot just like a success. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function makeLimiter(n: number): Limiter {
  if (n < 1) throw new Error(`makeLimiter: concurrency must be >= 1, got ${n}`);
  let active = 0;
  const queue: Array<() => void> = [];

  function pump(): void {
    while (active < n && queue.length > 0) {
      const start = queue.shift();
      if (start) {
        active++;
        start();
      }
    }
  }

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push(() => {
          task()
            .then(resolve, reject)
            .finally(() => {
              active--;
              pump();
            });
        });
        pump();
      });
    },
  };
}
