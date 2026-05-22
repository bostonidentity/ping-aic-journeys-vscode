/**
 * D36 — wire-shape types for the per-realm reverse-dependency index. Defined
 * in `domain/` (not `realm-index/`) so both `src/realm-index/build.ts` (the
 * producer) and the Search webview's message protocol (the consumer over
 * `postMessage`, lands in Slice 2) can import them without violating the
 * D21 boundary that forbids `src/webview/*` → `src/realm-index/*`.
 *
 * Mirrors the shape decisions made for `src/domain/resolved-graph.ts`:
 *   - One `EntityKind` union covers every reverse-lookup target.
 *   - Journeys and inner journeys both collapse to kind `"journey"` (they
 *     are the same AIC entity; only the entry point differs).
 *   - Library scripts collapse into `"script"` with `isLibrary === true`,
 *     so the inverted index treats `require()` edges as ordinary
 *     script→script refs.
 *   - ESVs that are referenced in a script body but absent from the
 *     tenant's variables+secrets lists contribute no entity (we can't
 *     describe what we don't have an `_id` for). The Search page's
 *     "missing ESV" surface, if added later, will be a separate path.
 */

/** Every kind that can appear as a top-level entity in the realm index. */
export type EntityKind = "journey" | "script" | "esv" | "theme" | "emailTemplate" | "socialIdp";

/** One indexed entity. Per-kind sub-classifiers are optional and only
 * meaningful for the kinds called out in their doc comments. */
export interface RealmIndexEntity {
  /** `${kind}:${id}` — composite stable identity used for lookups in
   * `RealmIndexEntry.entities` + `RealmIndexEntry.inboundRefs`. */
  key: string;
  kind: EntityKind;
  /** Domain id — script UUID, journey name, dotted ESV name, theme UUID,
   * email-template name, social-IdP name. */
  id: string;
  /** Resolved human-readable label. Falls back to `id` when the entity is
   * referenced from a node payload but couldn't be enriched (e.g. a script
   * fetch that 404'd). */
  displayName: string;
  /** Only meaningful for `kind === "script"`. True when the script's
   * `context === "LIBRARY"`. The Search page splits library scripts into
   * their own kind-group (mirrors the sidebar / resolved-view conventions). */
  isLibrary?: boolean;
  /** Only meaningful for `kind === "esv"`. Classifies the ESV by its
   * tenant-side definition. Set during index build from the
   * `listVariables` + `listSecrets` lookup. */
  esvKind?: "variable" | "secret";
}

/** One incoming reference targeting some entity. `inboundRefs[targetKey]`
 * is the list of `(fromKey, via)` pairs pointing AT `targetKey`. */
export interface ReverseRef {
  /** The entity REFERENCING the target — `${kind}:${id}`. */
  fromKey: string;
  /** Node type or syntactic form that linked source to target — e.g.
   * `"ScriptedDecisionNode"`, `"require()"`,
   * `"PageNode → ScriptedDecisionNode"`. Mirrors the `via` field on
   * `ResolvedEdge` (D35) so result rows render with the same vocabulary
   * across the inspector + Search surfaces. */
  via: string;
}

/** One built realm index — the cached value behind a Search-page tab. */
export interface RealmIndexEntry {
  host: string;
  realm: string;
  /** Flat entity map keyed by `${kind}:${id}`. Per-kind iteration is a
   * filter on this map; the flat shape keeps update logic simple at
   * build time. */
  entities: Record<string, RealmIndexEntity>;
  /** Inverted index: target entity key → list of refs pointing at it.
   * Missing or empty entry ⇒ orphan/unused. */
  inboundRefs: Record<string, ReverseRef[]>;
  /** Per-kind counts for the Search-page header. */
  counts: Record<EntityKind, number>;
  /** Epoch ms when the scan finished. */
  builtAt: number;
  /** Wall-clock duration of the build, ms. */
  scanDurationMs: number;
}

export function entityKeyOf(kind: EntityKind, id: string): string {
  return `${kind}:${id}`;
}

/** One node in a `findUsagePaths` tree — a slice of the realm's forward
 * dependency graph, pruned to just the paths that reach the searched
 * target. Lives in `domain/` (not `queries.ts`) so both the producer
 * (`src/realm-index/queries.ts`) and the Search webview can import it
 * without crossing D21 — same placement rationale as `ResolvedGraph`. */
export interface UsagePathNode {
  /** `${kind}:${id}` — the entity at this node. */
  key: string;
  entity: RealmIndexEntity;
  /** The `via` of the edge from this node's PARENT to this node. Absent
   * on roots. */
  via?: string;
  children: UsagePathNode[];
  /** True when this node's subtree was already rendered on an earlier
   * path — emitted as a `(dup)` marker, not recursed (mirrors the M4
   * Full-tree dup handling). */
  dup?: boolean;
  /** True for a non-journey root: an entity that reaches the target but
   * is itself reached by no journey — i.e. the target is kept alive only
   * by dead code. Journey roots are normal and unflagged. */
  orphanRoot?: boolean;
}

/** Result of `findUsagePaths` — every path from a journey (or orphan)
 * root down to the searched target, which appears as the leaf. */
export interface UsagePaths {
  /** `${kind}:${id}` of the searched entity. */
  targetKey: string;
  roots: UsagePathNode[];
}
