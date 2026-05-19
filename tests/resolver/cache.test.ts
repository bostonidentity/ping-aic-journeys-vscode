import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedGraph, RootDescriptor } from "@/domain/resolved-graph";
import { makeResolverCache, type ResolverKey } from "@/resolver/cache";
import type { WalkDeps } from "@/resolver/walk";
import { makeFakeLogger, makeFakePaicClient } from "../views/fakes";

function fakeGraph(rootKey: string): ResolvedGraph {
  return {
    rootKey,
    nodes: { [rootKey]: { key: rootKey, kind: "journey", id: "X", displayName: "X", depth: 0 } },
    edges: [],
    durationMs: 1,
  };
}

function makeWalkDeps(): WalkDeps {
  return { client: makeFakePaicClient({}), log: makeFakeLogger() };
}

const KEY_A: ResolverKey = { host: "host-a", realm: "alpha", kind: "journey", id: "Login" };
const KEY_B: ResolverKey = { host: "host-a", realm: "alpha", kind: "journey", id: "MFA" };
const KEY_C: ResolverKey = { host: "host-b", realm: "alpha", kind: "journey", id: "Login" };

describe("makeResolverCache", () => {
  let walk: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    walk = vi.fn(async (_deps: WalkDeps, root: RootDescriptor) =>
      fakeGraph(`${root.kind}:${root.id}`),
    );
  });

  it("invokes the walker on miss and stores the result", async () => {
    const cache = makeResolverCache({ log: makeFakeLogger(), walk });
    const g = await cache.resolve(KEY_A, makeWalkDeps());
    expect(walk).toHaveBeenCalledTimes(1);
    expect(walk).toHaveBeenCalledWith(expect.anything(), {
      kind: "journey",
      realm: "alpha",
      id: "Login",
    });
    expect(g.rootKey).toBe("journey:Login");
  });

  it("returns cached result on hit without re-invoking walker", async () => {
    const cache = makeResolverCache({ log: makeFakeLogger(), walk });
    const first = await cache.resolve(KEY_A, makeWalkDeps());
    const second = await cache.resolve(KEY_A, makeWalkDeps());
    const third = await cache.resolve(KEY_A, makeWalkDeps());
    expect(walk).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("dedupes concurrent calls for the same key into one walk", async () => {
    let releaseFn: () => void = () => {
      throw new Error("walker never invoked");
    };
    walk = vi.fn(
      () =>
        new Promise<ResolvedGraph>((resolve) => {
          releaseFn = () => resolve(fakeGraph("journey:Login"));
        }),
    );
    const cache = makeResolverCache({ log: makeFakeLogger(), walk });

    const p1 = cache.resolve(KEY_A, makeWalkDeps());
    const p2 = cache.resolve(KEY_A, makeWalkDeps());
    expect(walk).toHaveBeenCalledTimes(1);
    releaseFn();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(walk).toHaveBeenCalledTimes(1);
  });

  it("dropOne evicts the specific entry; next resolve re-walks", async () => {
    const cache = makeResolverCache({ log: makeFakeLogger(), walk });
    await cache.resolve(KEY_A, makeWalkDeps());
    expect(walk).toHaveBeenCalledTimes(1);
    cache.dropOne(KEY_A);
    await cache.resolve(KEY_A, makeWalkDeps());
    expect(walk).toHaveBeenCalledTimes(2);
  });

  it("dropAllForHost evicts every entry under that host", async () => {
    const cache = makeResolverCache({ log: makeFakeLogger(), walk });
    await cache.resolve(KEY_A, makeWalkDeps());
    await cache.resolve(KEY_B, makeWalkDeps());
    await cache.resolve(KEY_C, makeWalkDeps());
    expect(walk).toHaveBeenCalledTimes(3);

    cache.dropAllForHost("host-a");

    // host-a entries re-walk; host-b stays cached
    await cache.resolve(KEY_A, makeWalkDeps());
    await cache.resolve(KEY_B, makeWalkDeps());
    await cache.resolve(KEY_C, makeWalkDeps());
    expect(walk).toHaveBeenCalledTimes(5); // +2 for A and B; C untouched
  });

  it("dropAllForHost preserves entries for other hosts", async () => {
    const cache = makeResolverCache({ log: makeFakeLogger(), walk });
    const cHost = await cache.resolve(KEY_C, makeWalkDeps());
    cache.dropAllForHost("host-a");
    const cHostAgain = await cache.resolve(KEY_C, makeWalkDeps());
    expect(cHostAgain).toBe(cHost);
    expect(walk).toHaveBeenCalledTimes(1);
  });

  it("dispose clears all entries", async () => {
    const cache = makeResolverCache({ log: makeFakeLogger(), walk });
    await cache.resolve(KEY_A, makeWalkDeps());
    await cache.resolve(KEY_C, makeWalkDeps());
    expect(walk).toHaveBeenCalledTimes(2);
    cache.dispose();
    await cache.resolve(KEY_A, makeWalkDeps());
    await cache.resolve(KEY_C, makeWalkDeps());
    expect(walk).toHaveBeenCalledTimes(4);
  });

  it("walker errors are not cached — next resolve retries", async () => {
    let attempts = 0;
    walk = vi.fn(async () => {
      await Promise.resolve();
      attempts++;
      if (attempts === 1) throw new Error("boom");
      return fakeGraph("journey:Login");
    });
    const cache = makeResolverCache({ log: makeFakeLogger(), walk });
    await expect(cache.resolve(KEY_A, makeWalkDeps())).rejects.toThrow("boom");
    const g = await cache.resolve(KEY_A, makeWalkDeps());
    expect(g.rootKey).toBe("journey:Login");
    expect(walk).toHaveBeenCalledTimes(2);
  });

  it("keys with different kind or id are isolated", async () => {
    const cache = makeResolverCache({ log: makeFakeLogger(), walk });
    const sameId = "Login";
    const journeyKey: ResolverKey = {
      host: "host-a",
      realm: "alpha",
      kind: "journey",
      id: sameId,
    };
    const scriptKey: ResolverKey = {
      host: "host-a",
      realm: "alpha",
      kind: "script",
      id: sameId,
    };
    await cache.resolve(journeyKey, makeWalkDeps());
    await cache.resolve(scriptKey, makeWalkDeps());
    expect(walk).toHaveBeenCalledTimes(2);

    // Hits — no additional walks.
    await cache.resolve(journeyKey, makeWalkDeps());
    await cache.resolve(scriptKey, makeWalkDeps());
    expect(walk).toHaveBeenCalledTimes(2);
  });

  it("exposes a callable dispose (Disposable shape)", () => {
    const cache = makeResolverCache({ log: makeFakeLogger() });
    expect(typeof cache.dispose).toBe("function");
    // Disposing a fresh cache is a no-op + must not throw.
    expect(() => cache.dispose()).not.toThrow();
  });
});
