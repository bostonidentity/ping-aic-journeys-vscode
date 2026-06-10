/**
 * D36 — typed message protocol between the extension host and the Search
 * webview (React). Direction encoded in the union name:
 *   - `W2E` — webview → extension
 *   - `E2W` — extension → webview
 *
 * The Search page is a SINGLETON webview (supersedes D36's original
 * "single instance per (host, realm)" rule — see the 2026-05-19 redesign
 * note in `docs/design-plan.md` D36). The page picks its `(host, realm)`
 * via two in-page dropdowns rather than a pre-open QuickPick. Because the
 * selection lives in the webview, every host/realm-scoped W2E message
 * carries `host` + `realm` explicitly — the extension-side panel is
 * stateless w.r.t. the current selection. Result E2W messages echo
 * `host` + `realm` so the React app can drop stale replies if the user
 * switched the dropdowns mid-flight.
 *
 * Connection list ships in the embedded payload (settings data, no
 * network). Realm lists require a `listRealms` round-trip per connection
 * (a `client.listRealms()` call) — fetched on demand when the connection
 * dropdown changes.
 */

import type {
  EntityKind,
  RealmIndexEntity,
  ReverseRef,
  UsagePaths,
} from "../../domain/realm-index";

/** The three query modes — segmented control values. */
export type QueryMode = "findUsages" | "byName" | "unused";

/** Lightweight cache stats posted in `peekResult` / `buildDone`. */
export interface CacheStatus {
  /** Epoch ms; null when no entry is cached for (host, realm). */
  builtAt: number | null;
  scanDurationMs: number | null;
  counts: Record<EntityKind, number> | null;
}

/** A connection the user can select in the dropdown. */
export interface ConnectionInfo {
  host: string;
  name?: string;
  /** Connection kind (D41) — drives whether the root realm is shown. Optional
   * for back-compat; absent is treated as "paic". */
  kind?: "paic" | "onprem";
}

/** Optional query pre-fill (the card-portal `[🔍 Find usages]` button). */
export interface SearchPrefill {
  mode?: QueryMode;
  /** For findUsages — the target entity's `${kind}:${id}` key. */
  targetKey?: string;
  /** For findUsages — the kind of the target, used to seed the dropdown. */
  targetKind?: EntityKind;
  /** For byName — initial pattern. */
  namePattern?: string;
}

/** Initial payload embedded via `data-paic-payload` on the mount div. */
export interface SearchPayload {
  /** Every registered connection — populates the connection dropdown. */
  connections: readonly ConnectionInfo[];
  /** Pre-selected connection host (right-click connection / realm, or
   * card portal). Null when opened from the sidebar icon / palette. */
  selectedHost: string | null;
  /** Pre-selected realm (right-click realm, or card portal). Null
   * otherwise — the user picks it from the realm dropdown. */
  selectedRealm: string | null;
  /** Query prefill (card portal findUsages). */
  prefill: SearchPrefill | null;
}

/** A hydrated reverse reference — findUsages result rows carry the `from`
 * entity directly. `entity: null` when the from-entity was dropped from
 * the index (defensive — should not normally happen). */
export interface HydratedReverseRef {
  ref: ReverseRef;
  entity: RealmIndexEntity | null;
}

// ─── Webview → Extension ─────────────────────────────────────────────────

export type W2E =
  | { type: "ready" }
  | { type: "listRealms"; host: string }
  | { type: "peek"; host: string; realm: string }
  | { type: "build"; host: string; realm: string }
  | { type: "rescan"; host: string; realm: string }
  | { type: "listEntities"; host: string; realm: string }
  | {
      type: "query";
      host: string;
      realm: string;
      mode: "findUsages";
      targetKey: string;
    }
  | {
      type: "query";
      host: string;
      realm: string;
      mode: "byName";
      pattern: string;
      kinds: readonly EntityKind[];
    }
  | {
      type: "query";
      host: string;
      realm: string;
      mode: "unused";
      kinds: readonly EntityKind[];
    }
  | {
      type: "previewByKey";
      host: string;
      realm: string;
      kind: EntityKind;
      id: string;
      displayName: string;
      isLibrary?: boolean;
      esvKind?: "variable" | "secret" | "missing";
    };

// ─── Extension → Webview ─────────────────────────────────────────────────

export type E2W =
  | { type: "realmsResult"; host: string; realms: readonly string[] }
  | { type: "realmsError"; host: string; message: string }
  | { type: "peekResult"; host: string; realm: string; status: CacheStatus }
  | { type: "buildStart"; host: string; realm: string }
  | {
      /** Coarse build progress for the in-page progress bar. `journeys`
       * phase is determinate (`done` / `total`); the others report phase
       * only. Coalesced extension-side (posted at most ~5 Hz). */
      type: "buildProgress";
      host: string;
      realm: string;
      phase: "preparing" | "journeys" | "scripts" | "finishing";
      done?: number;
      total?: number;
    }
  | { type: "buildDone"; host: string; realm: string; status: CacheStatus }
  | { type: "buildError"; host: string; realm: string; message: string }
  | {
      type: "listEntitiesResult";
      host: string;
      realm: string;
      entitiesByKind: Record<EntityKind, readonly RealmIndexEntity[]>;
    }
  | {
      type: "queryResult";
      host: string;
      realm: string;
      mode: "findUsages";
      targetKey: string;
      /** Direct (one-hop) inbound refs — the `List` view. */
      refs: readonly HydratedReverseRef[];
      /** Pruned journey → … → target path tree — the `Tree` view. Computed
       * alongside `refs` from the same entry (cheap, pure), so the
       * webview's `List | Tree` toggle needs no extra round-trip. */
      paths: UsagePaths;
    }
  | {
      type: "queryResult";
      host: string;
      realm: string;
      mode: "byName";
      results: readonly RealmIndexEntity[];
    }
  | {
      type: "queryResult";
      host: string;
      realm: string;
      mode: "unused";
      results: readonly RealmIndexEntity[];
    }
  | { type: "queryError"; host: string; realm: string; message: string };

export function isW2E(m: unknown): m is W2E {
  if (!m || typeof m !== "object") return false;
  const t = (m as { type?: unknown }).type;
  return (
    t === "ready" ||
    t === "listRealms" ||
    t === "peek" ||
    t === "build" ||
    t === "rescan" ||
    t === "listEntities" ||
    t === "query" ||
    t === "previewByKey"
  );
}

export function isE2W(m: unknown): m is E2W {
  if (!m || typeof m !== "object") return false;
  const t = (m as { type?: unknown }).type;
  return (
    t === "realmsResult" ||
    t === "realmsError" ||
    t === "peekResult" ||
    t === "buildStart" ||
    t === "buildProgress" ||
    t === "buildDone" ||
    t === "buildError" ||
    t === "listEntitiesResult" ||
    t === "queryResult" ||
    t === "queryError"
  );
}
