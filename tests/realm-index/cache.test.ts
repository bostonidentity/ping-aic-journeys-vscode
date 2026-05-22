import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RealmIndexEntry } from "@/domain/realm-index";
import type { RealmIndexBuildDeps } from "@/realm-index/build";
import { makeRealmIndexCache } from "@/realm-index/cache";
import { makeFakeLogger, makeFakePaicClient } from "../views/fakes";

function fakeEntry(host: string, realm: string): RealmIndexEntry {
  return {
    host,
    realm,
    entities: {},
    inboundRefs: {},
    counts: {
      journey: 0,
      script: 0,
      esv: 0,
      theme: 0,
      emailTemplate: 0,
      socialIdp: 0,
    },
    builtAt: 1_700_000_000_000,
    scanDurationMs: 1,
  };
}

function makeBuildDeps(): RealmIndexBuildDeps {
  return { client: makeFakePaicClient({}), log: makeFakeLogger() };
}

const HOST_A = "host-a";
const HOST_B = "host-b";

describe("makeRealmIndexCache", () => {
  let build: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    build = vi.fn(async (_deps: RealmIndexBuildDeps, host: string, realm: string) =>
      fakeEntry(host, realm),
    );
  });

  it("peek returns null when no entry exists", () => {
    const cache = makeRealmIndexCache({ log: makeFakeLogger(), build });
    expect(cache.peek(HOST_A, "alpha")).toBeNull();
    expect(build).not.toHaveBeenCalled();
  });

  it("build invokes the builder on miss and stores the result", async () => {
    const cache = makeRealmIndexCache({ log: makeFakeLogger(), build });
    const e = await cache.build(HOST_A, "alpha", makeBuildDeps());
    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith(expect.anything(), HOST_A, "alpha");
    expect(e.host).toBe(HOST_A);
    expect(e.realm).toBe("alpha");
  });

  it("peek returns the stored entry after build", async () => {
    const cache = makeRealmIndexCache({ log: makeFakeLogger(), build });
    const built = await cache.build(HOST_A, "alpha", makeBuildDeps());
    expect(cache.peek(HOST_A, "alpha")).toBe(built);
  });

  it("concurrent build calls for the same key share one builder invocation", async () => {
    let releaseFn: () => void = () => {
      throw new Error("builder never invoked");
    };
    build = vi.fn(
      () =>
        new Promise<RealmIndexEntry>((resolve) => {
          releaseFn = () => resolve(fakeEntry(HOST_A, "alpha"));
        }),
    );
    const cache = makeRealmIndexCache({ log: makeFakeLogger(), build });

    const p1 = cache.build(HOST_A, "alpha", makeBuildDeps());
    const p2 = cache.build(HOST_A, "alpha", makeBuildDeps());
    expect(build).toHaveBeenCalledTimes(1);
    releaseFn();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("dropOne evicts only that (host, realm) entry; others stay cached", async () => {
    const cache = makeRealmIndexCache({ log: makeFakeLogger(), build });
    await cache.build(HOST_A, "alpha", makeBuildDeps());
    await cache.build(HOST_A, "beta", makeBuildDeps());
    expect(build).toHaveBeenCalledTimes(2);

    cache.dropOne(HOST_A, "alpha");
    expect(cache.peek(HOST_A, "alpha")).toBeNull();
    expect(cache.peek(HOST_A, "beta")).not.toBeNull();

    // Re-build alpha → second alpha invocation (3rd build call total).
    await cache.build(HOST_A, "alpha", makeBuildDeps());
    expect(build).toHaveBeenCalledTimes(3);
  });

  it("dropAllForHost evicts every entry under that host", async () => {
    const cache = makeRealmIndexCache({ log: makeFakeLogger(), build });
    await cache.build(HOST_A, "alpha", makeBuildDeps());
    await cache.build(HOST_A, "beta", makeBuildDeps());
    await cache.build(HOST_B, "alpha", makeBuildDeps());
    expect(build).toHaveBeenCalledTimes(3);

    cache.dropAllForHost(HOST_A);

    expect(cache.peek(HOST_A, "alpha")).toBeNull();
    expect(cache.peek(HOST_A, "beta")).toBeNull();
    expect(cache.peek(HOST_B, "alpha")).not.toBeNull();

    // Re-build host-a entries; host-b stays cached.
    await cache.build(HOST_A, "alpha", makeBuildDeps());
    await cache.build(HOST_A, "beta", makeBuildDeps());
    await cache.build(HOST_B, "alpha", makeBuildDeps());
    expect(build).toHaveBeenCalledTimes(5); // +2 for host-a; host-b untouched
  });

  it("dropAllForHost preserves entries for other hosts", async () => {
    const cache = makeRealmIndexCache({ log: makeFakeLogger(), build });
    const bEntry = await cache.build(HOST_B, "alpha", makeBuildDeps());
    cache.dropAllForHost(HOST_A);
    expect(cache.peek(HOST_B, "alpha")).toBe(bEntry);
  });

  it("builder errors are not cached — next build retries", async () => {
    let attempts = 0;
    build = vi.fn(async (_deps, host: string, realm: string) => {
      await Promise.resolve();
      attempts++;
      if (attempts === 1) throw new Error("boom");
      return fakeEntry(host, realm);
    });
    const cache = makeRealmIndexCache({ log: makeFakeLogger(), build });
    await expect(cache.build(HOST_A, "alpha", makeBuildDeps())).rejects.toThrow("boom");
    expect(cache.peek(HOST_A, "alpha")).toBeNull();
    const ok = await cache.build(HOST_A, "alpha", makeBuildDeps());
    expect(ok.host).toBe(HOST_A);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("dispose clears all entries; next build re-walks", async () => {
    const cache = makeRealmIndexCache({ log: makeFakeLogger(), build });
    await cache.build(HOST_A, "alpha", makeBuildDeps());
    await cache.build(HOST_B, "alpha", makeBuildDeps());
    expect(build).toHaveBeenCalledTimes(2);

    cache.dispose();
    expect(cache.peek(HOST_A, "alpha")).toBeNull();
    expect(cache.peek(HOST_B, "alpha")).toBeNull();

    await cache.build(HOST_A, "alpha", makeBuildDeps());
    await cache.build(HOST_B, "alpha", makeBuildDeps());
    expect(build).toHaveBeenCalledTimes(4);
  });

  it("entries keyed by (host, realm) are isolated across realms", async () => {
    const cache = makeRealmIndexCache({ log: makeFakeLogger(), build });
    const alpha = await cache.build(HOST_A, "alpha", makeBuildDeps());
    const beta = await cache.build(HOST_A, "beta", makeBuildDeps());
    expect(alpha).not.toBe(beta);
    expect(alpha.realm).toBe("alpha");
    expect(beta.realm).toBe("beta");
    expect(build).toHaveBeenCalledTimes(2);

    // Hits — no additional builds.
    await cache.build(HOST_A, "alpha", makeBuildDeps());
    await cache.build(HOST_A, "beta", makeBuildDeps());
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("exposes a callable dispose (Disposable shape)", () => {
    const cache = makeRealmIndexCache({ log: makeFakeLogger() });
    expect(typeof cache.dispose).toBe("function");
    expect(() => cache.dispose()).not.toThrow();
  });
});
