/**
 * D35 — resolver cache. Stores forward-dep graphs keyed by
 * `{host, realm, kind, id}`. In-flight deduplication so two concurrent
 * `resolve` calls for the same root share one walk. Pure data layer; no
 * `vscode` coupling.
 *
 * Lives in `src/resolver/` and is isolated from `src/tenants/` per D21 —
 * the cache cannot import `TenantsRegistry`, so registry-driven
 * invalidation is wired from `src/extension.ts` (the one site that
 * imports both). This mirrors how `src/tenants/client-cache.ts` is
 * invalidated today.
 */

import type { ResolvedGraph, RootDescriptor, RootKind } from "../domain/resolved-graph";
import type { Logger } from "../util/logger";
import { type WalkDeps, walkRoot } from "./walk";

/** Composite key for a cached forward-dep graph. `host` scopes by
 * connection; `kind` keeps journey/script roots from colliding; `realm`
 * keeps cross-realm same-id roots distinct. */
export interface ResolverKey {
  host: string;
  realm: string;
  kind: RootKind;
  id: string;
}

export interface ResolverCache {
  /** Get the resolved graph for a root. Returns the cached entry if
   * present; otherwise invokes the walker, stores the result, and returns
   * it. Concurrent calls for the same key share one walk. */
  resolve(key: ResolverKey, walkDeps: WalkDeps): Promise<ResolvedGraph>;
  /** Drop one entry. Surgical per-card refresh (D35). */
  dropOne(key: ResolverKey): void;
  /** Drop every entry for a connection. Used by registry mutations and
   * sidebar refresh paths. */
  dropAllForHost(host: string): void;
  /** Clear everything. Called on extension dispose. */
  dispose(): void;
}

export interface ResolverCacheDeps {
  log: Logger;
  /** Walker function. Production passes `walkRoot` (default); tests pass
   * a stub so cache logic can be exercised in isolation. */
  walk?: (deps: WalkDeps, root: RootDescriptor) => Promise<ResolvedGraph>;
}

function keyString(k: ResolverKey): string {
  return `${k.host}|${k.realm}|${k.kind}|${k.id}`;
}

function isHostPrefix(s: string, host: string): boolean {
  return s.startsWith(`${host}|`);
}

export function makeResolverCache(deps: ResolverCacheDeps): ResolverCache {
  const log = deps.log.child({ component: "resolver.cache" });
  const walk = deps.walk ?? walkRoot;
  const entries = new Map<string, ResolvedGraph>();
  const inFlight = new Map<string, Promise<ResolvedGraph>>();

  return {
    resolve(key, walkDeps) {
      const k = keyString(key);
      const cached = entries.get(k);
      if (cached) {
        log.trace({ event: "resolver.cache.hit", key: k }, "Cache hit");
        return Promise.resolve(cached);
      }
      const inflight = inFlight.get(k);
      if (inflight) {
        log.trace({ event: "resolver.cache.inflight", key: k }, "In-flight hit");
        return inflight;
      }

      log.debug({ event: "resolver.cache.miss", key: k }, "Cache miss — walking");
      const descriptor: RootDescriptor = { kind: key.kind, realm: key.realm, id: key.id };
      const promise = (async (): Promise<ResolvedGraph> => {
        try {
          const result = await walk(walkDeps, descriptor);
          entries.set(k, result);
          return result;
        } finally {
          inFlight.delete(k);
        }
      })();
      inFlight.set(k, promise);
      return promise;
    },

    dropOne(key) {
      const k = keyString(key);
      const removed = entries.delete(k);
      inFlight.delete(k);
      if (removed) {
        log.debug({ event: "resolver.cache.dropOne", key: k }, "Dropped cache entry");
      }
    },

    dropAllForHost(host) {
      let count = 0;
      for (const k of [...entries.keys()]) {
        if (isHostPrefix(k, host)) {
          entries.delete(k);
          count++;
        }
      }
      for (const k of [...inFlight.keys()]) {
        if (isHostPrefix(k, host)) inFlight.delete(k);
      }
      if (count > 0) {
        log.debug(
          // biome-ignore lint/security/noSecrets: structured event name, not a secret
          { event: "resolver.cache.dropAllForHost", host, dropped: count },
          "Dropped resolver entries for host",
        );
      }
    },

    dispose() {
      entries.clear();
      inFlight.clear();
      log.debug({ event: "resolver.cache.dispose" }, "Resolver cache disposed");
    },
  };
}
