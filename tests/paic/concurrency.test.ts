import { describe, expect, it } from "vitest";
import { makeLimiter, mapConcurrent } from "@/paic/concurrency";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("mapConcurrent", () => {
  it("preserves input order in the result array", async () => {
    const items = [10, 20, 30, 40];
    const out = await mapConcurrent(items, 2, async (x) => x * 2);
    expect(out).toEqual([20, 40, 60, 80]);
  });

  it("respects the concurrency cap", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    let running = 0;
    let maxObserved = 0;
    const gates = items.map(() => deferred<void>());

    const run = mapConcurrent(items, 3, async (_x, i) => {
      running++;
      maxObserved = Math.max(maxObserved, running);
      await gates[i].promise;
      running--;
      return i;
    });

    // Let microtasks settle so the first batch starts.
    await new Promise((r) => setTimeout(r, 10));
    expect(maxObserved).toBe(3);
    expect(running).toBe(3);

    // Release them all and await completion.
    for (const g of gates) g.resolve();
    await run;
    expect(maxObserved).toBe(3);
  });

  it("propagates the first rejection", async () => {
    const items = [0, 1, 2, 3, 4];
    const boom = new Error("worker failed at 2");

    await expect(
      mapConcurrent(items, 2, async (x) => {
        // Yield to the microtask queue so the worker pool actually starts in
        // parallel before one of them rejects.
        await Promise.resolve();
        if (x === 2) throw boom;
        return x;
      }),
    ).rejects.toBe(boom);
  });

  it("rejects when concurrency is < 1", async () => {
    await expect(mapConcurrent([1], 0, async (x) => x)).rejects.toThrow(/concurrency must be >= 1/);
  });
});

describe("makeLimiter", () => {
  it("caps total in-flight tasks across independent run() calls", async () => {
    const limit = makeLimiter(3);
    let running = 0;
    let maxObserved = 0;
    const gates = Array.from({ length: 10 }, () => deferred<void>());

    // Fire 10 independent run() calls — they are NOT a single mapConcurrent
    // pool, but the shared limiter must still cap them at 3.
    const all = gates.map((g) =>
      limit.run(async () => {
        running++;
        maxObserved = Math.max(maxObserved, running);
        await g.promise;
        running--;
      }),
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(maxObserved).toBe(3);
    expect(running).toBe(3);

    for (const g of gates) g.resolve();
    await Promise.all(all);
    expect(maxObserved).toBe(3);
  });

  it("resolves with the task result", async () => {
    const limit = makeLimiter(2);
    const out = await Promise.all([1, 2, 3].map((x) => limit.run(async () => x * 10)));
    expect(out).toEqual([10, 20, 30]);
  });

  it("a rejected task frees its slot and propagates the rejection", async () => {
    const limit = makeLimiter(1);
    const boom = new Error("task failed");
    await expect(limit.run(async () => Promise.reject(boom))).rejects.toBe(boom);
    // The slot must be free again — a follow-up task still runs.
    await expect(limit.run(async () => "ok")).resolves.toBe("ok");
  });

  it("throws when concurrency is < 1", () => {
    expect(() => makeLimiter(0)).toThrow(/concurrency must be >= 1/);
  });
});
