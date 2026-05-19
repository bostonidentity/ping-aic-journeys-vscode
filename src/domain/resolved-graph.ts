/**
 * D35 — wire-shape types for the forward dep resolver. Defined in `domain/`
 * (not `resolver/`) so both `src/resolver/walk.ts` (the producer) and the
 * webview message protocol (the consumer over `postMessage`) can import
 * them without violating the D21 boundary that forbids
 * `src/webview/*` → `src/resolver/*`.
 *
 * The graph collapses some "how was this entity reached" distinctions into
 * a single `kind`:
 *   - Journeys and inner journeys both → kind `"journey"` (they are the same
 *     AIC entity; only the entry point differs). This is what lets the BFS
 *     detect cycles like `Journey A → InnerTree B → InnerTree A`.
 *   - Regular scripts and library scripts both → kind `"script"`. A library
 *     script is just `script.context === "LIBRARY"`; the wire shape is
 *     identical.
 *
 * `RootKind` preserves the user-facing entry distinction (the inspector
 * card type the user clicked Full from) for any UI / telemetry that cares.
 */

/** Every kind that can appear inside a resolved graph as a node. */
export type ResolvedNodeKind =
  | "journey"
  | "script"
  | "esv"
  | "theme"
  | "emailTemplate"
  | "socialIdp";

/** Kinds that can be the starting root of a forward walk. The two extras
 * (`innerJourney`, `libraryScript`) collapse to `journey` / `script` in the
 * resolved-graph node kinds — see file header. */
export type RootKind = "journey" | "innerJourney" | "script" | "libraryScript";

/** Identifies the entity the caller wants resolved. */
export interface RootDescriptor {
  kind: RootKind;
  realm: string;
  id: string;
}

/** A node in the resolved graph. `key` is the stable identity used by
 * `edges` and is the lookup key in `ResolvedGraph.nodes`. */
export interface ResolvedNode {
  /** `${kind}:${id}` — composite stable identity. */
  key: string;
  kind: ResolvedNodeKind;
  /** Domain id (script UUID, journey name, dotted ESV name, etc.). */
  id: string;
  /** Resolved human-readable label. Falls back to `id` when the entity is
   * missing in the tenant. */
  displayName: string;
  /** Shortest BFS depth from the root. Root is depth 0. */
  depth: number;
  /** Only meaningful for `kind === "script"`. True when `script.context ===
   * "LIBRARY"` (the script was authored as a reusable library module). The
   * webview uses this to split scripts and library scripts into separate
   * kind-groups in the Full / Flat views and to pick the right codicon
   * (mirrors the sidebar's `ScriptNode` vs `LibraryScriptNode` split). */
  isLibrary?: boolean;
  /** Only meaningful for `kind === "esv"`. Distinguishes ESV variables vs
   * secrets vs references whose name resolves to neither (`missing`).
   * Drives the per-kind icon (variable → `symbol-variable`, secret →
   * `lock`, missing → `warning`) and the split into separate divider
   * groups in the resolved + sidebar views. Mirrors the sidebar's
   * `EsvNode.kind` field (D22). */
  esvKind?: "variable" | "secret" | "missing";
}

export interface ResolvedEdge {
  fromKey: string;
  toKey: string;
  /** Why this edge exists — the node type or syntactic form that linked
   * parent to child (e.g. `"ScriptedDecisionNode"`, `"require()"`,
   * `"PageNode → ScriptedDecisionNode"`). For debug / telemetry. */
  via?: string;
  /** True when the target was already visited at a shallower depth — the
   * BFS records the edge but does not re-walk. UI renders these as
   * `(dup)` markers. */
  cycle?: boolean;
}

export interface ResolvedGraph {
  rootKey: string;
  nodes: Record<string, ResolvedNode>;
  edges: ResolvedEdge[];
  /** Wall-clock duration of the walk in milliseconds. Surfaced in the
   * Full-tree footer. */
  durationMs: number;
}

export function keyOf(kind: ResolvedNodeKind, id: string): string {
  return `${kind}:${id}`;
}
