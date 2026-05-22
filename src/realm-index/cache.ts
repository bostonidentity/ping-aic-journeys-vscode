/**
 * D36 — realm-index cache. Stores `RealmIndexEntry` values keyed by
 * `{host, realm}`. Mirrors `src/resolver/cache.ts` (D35) in structure;
 * differs by exposing a synchronous `peek` since the Search-page header
 * displays cache status without triggering a build.
 *
 * Per D21:
 *   - This file does NOT import `TenantsRegistry`. Per-host invalidation is
 *     wired from `src/extension.ts` (the one site that imports both layers)
 *     and lands in M5 Slice 2 alongside the Search webview.
 *   - This file does NOT subscribe to sidebar-refresh events. Per D36 the
 *     realm index is invalidated ONLY by (a) the explicit `Rescan realm`
 *     button → `dropOne`, and (b) `registry.onDidChange` → `dropAllForHost`.
 *     Sidebar refresh is deliberately decoupled — rebuilding a realm index
 *     is a 10-second-class operation and shouldn't trigger silently.
 *
 * Builder errors are NOT cached. A failed build clears the in-flight entry
 * via `finally`; the next `build` call retries from scratch. This matches
 * the resolver cache's behavior for the same reason: tenant blips
 * shouldn't permanently sour a Search page until the user navigates away.
 */

import type { RealmIndexEntry } from "../domain/realm-index";
import type { Logger } from "../util/logger";
import { buildRealmIndex, type RealmIndexBuildDeps } from "./build";

export interface RealmIndexCache {
  /** Return the cached entry for (host, realm), or null. Never builds —
   * the Search-page header uses this to render cache status before the
   * user clicks `Build index`. */
  peek(host: string, realm: string): RealmIndexEntry | null;
  /** Build the index for (host, realm), caching the result. Concurrent
   * calls for the same key share one build (single-flight). Builder
   * errors clear the in-flight entry but do not cache a failure. */
  build(host: string, realm: string, deps: RealmIndexBuildDeps): Promise<RealmIndexEntry>;
  /** Drop one entry — surgical per-realm Rescan path. */
  dropOne(host: string, realm: string): void;
  /** Drop every entry for a connection — used by `registry.onDidChange`
   * wiring in Slice 2. */
  dropAllForHost(host: string): void;
  /** Clear everything. Called on extension dispose. */
  dispose(): void;
}

export interface RealmIndexCacheDeps {
  log: Logger;
  /** Builder function. Production passes `buildRealmIndex` (default);
   * tests pass a stub via `vi.fn` so the cache logic can be exercised in
   * isolation. */
  build?: typeof buildRealmIndex;
}

function keyString(host: string, realm: string): string {
  return `${host}|${realm}`;
}

function isHostPrefix(k: string, host: string): boolean {
  return k.startsWith(`${host}|`);
}

export function makeRealmIndexCache(deps: RealmIndexCacheDeps): RealmIndexCache {
  const log = deps.log.child({ component: "realm-index.cache" });
  const build = deps.build ?? buildRealmIndex;
  const entries = new Map<string, RealmIndexEntry>();
  const inFlight = new Map<string, Promise<RealmIndexEntry>>();

  return {
    peek(host, realm) {
      return entries.get(keyString(host, realm)) ?? null;
    },

    build(host, realm, buildDeps) {
      const k = keyString(host, realm);
      const cached = entries.get(k);
      if (cached) {
        log.trace({ event: "realm-index.cache.hit", key: k }, "Cache hit");
        return Promise.resolve(cached);
      }
      const existing = inFlight.get(k);
      if (existing) {
        log.trace({ event: "realm-index.cache.inflight", key: k }, "In-flight hit");
        return existing;
      }
      log.debug({ event: "realm-index.cache.build", key: k }, "Building realm index");
      const promise = (async (): Promise<RealmIndexEntry> => {
        try {
          const result = await build(buildDeps, host, realm);
          entries.set(k, result);
          return result;
        } finally {
          inFlight.delete(k);
        }
      })();
      inFlight.set(k, promise);
      return promise;
    },

    dropOne(host, realm) {
      const k = keyString(host, realm);
      const removed = entries.delete(k);
      inFlight.delete(k);
      if (removed) {
        log.debug({ event: "realm-index.cache.dropOne", key: k }, "Dropped realm index entry");
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
          {
            // biome-ignore lint/security/noSecrets: structured event name, not a secret
            event: "realm-index.cache.dropAllForHost",
            host,
            dropped: count,
          },
          "Dropped realm index entries for host",
        );
      }
    },

    dispose() {
      entries.clear();
      inFlight.clear();
      log.debug({ event: "realm-index.cache.dispose" }, "Realm index cache disposed");
    },
  };
}
