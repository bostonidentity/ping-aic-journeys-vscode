/**
 * Webview-side grouping/sort/divider helper for the Full + Flat dep views.
 * Mirrors the sidebar tree's D33 pattern (`src/views/nodes/grouping.ts`):
 *
 *   - Group children by `ResolvedNodeKind` (subdividing scripts into
 *     "regular script" vs "library script" via `node.isLibrary`).
 *   - Insert `── <Kind> ──` divider rows between buckets.
 *   - Sort case-insensitively within each bucket by `displayName`.
 *
 * Pure function, no React, no `vscode` imports — safe to live in the
 * webview UI sandbox (D21).
 */

import type { ResolvedEdge, ResolvedNode } from "../../../../domain/resolved-graph";

/** Display-level kind used by the Full / Flat views. Subdivides "script"
 * into regular Scripts (kind="script", isLibrary=false/undefined) and
 * Library Scripts (kind="script", isLibrary=true) so the sidebar's icon
 * + section split is preserved. */
export type DisplayKind =
  | "innerJourney"
  | "script"
  | "libraryScript"
  | "theme"
  | "emailTemplate"
  | "socialIdp"
  | "esvVariable"
  | "esvSecret"
  | "esvMissing"
  /** Fallback when a node has `kind === "esv"` but no `esvKind` (older
   * fixtures, classification fetch failed). Renders as a single
   * `── ESVs ──` block — preserves pre-D22-split behavior. */
  | "esv";

/** Section ordering — matches the sidebar tree's category-header order
 * (`src/views/nodes/grouping.ts`). ESV variants sort at the end:
 * variables → secrets → missing → unclassified-fallback. */
const KIND_ORDER: Record<DisplayKind, number> = {
  innerJourney: 0,
  script: 1,
  libraryScript: 2,
  theme: 3,
  emailTemplate: 4,
  socialIdp: 5,
  esvVariable: 6,
  esvSecret: 7,
  esvMissing: 8,
  esv: 9,
};

const KIND_LABEL: Record<DisplayKind, string> = {
  innerJourney: "Inner journeys",
  script: "Scripts",
  libraryScript: "Library scripts",
  theme: "Themes",
  emailTemplate: "Email templates",
  socialIdp: "Social IdPs",
  esvVariable: "ESV Variables",
  esvSecret: "ESV Secrets",
  esvMissing: "ESVs (missing)",
  esv: "ESVs",
};

/** Codicon names per display kind. Mirror the sidebar's `vscode.ThemeIcon`
 * choices (`src/views/nodes/{journey,inner-journey,script,library-script,
 * theme,email-template,social-idp,esv}.ts`). */
const KIND_ICON: Record<DisplayKind, string> = {
  innerJourney: "type-hierarchy-sub",
  script: "symbol-method",
  libraryScript: "library",
  theme: "paintcan",
  emailTemplate: "mail",
  socialIdp: "link-external",
  esvVariable: "symbol-variable",
  esvSecret: "lock",
  esvMissing: "warning",
  esv: "symbol-variable",
};

export function displayKindOf(node: ResolvedNode): DisplayKind {
  switch (node.kind) {
    case "journey":
      // Inside the Full / Flat tree, every visible journey-kind row is
      // reached transitively from the root — so it's an inner-journey-like
      // reference. Use the sidebar's inner-journey icon + section.
      return "innerJourney";
    case "script":
      return node.isLibrary ? "libraryScript" : "script";
    case "esv":
      if (node.esvKind === "variable") return "esvVariable";
      if (node.esvKind === "secret") return "esvSecret";
      if (node.esvKind === "missing") return "esvMissing";
      return "esv";
    case "theme":
    case "emailTemplate":
    case "socialIdp":
      return node.kind;
  }
}

export function labelFor(kind: DisplayKind): string {
  return KIND_LABEL[kind];
}

export function iconFor(kind: DisplayKind): string {
  return KIND_ICON[kind];
}

/** A row emitted by `groupAndSort` — either a divider header (with bucket
 * count for `── Inner journeys (3) ──` style) or a node with its inbound
 * edge (so the caller can carry `via` / `cycle` metadata). */
export type GroupedRow =
  | { row: "divider"; kind: DisplayKind; label: string; count: number }
  | { row: "node"; node: ResolvedNode; edge: ResolvedEdge };

/**
 * Group + sort + interleave dividers. `children` is the list of nodes at
 * one level (e.g. one parent's children in the Full view, or all unique
 * non-root nodes in the Flat view). `edgeByToKey` maps a node's key to
 * the edge that pointed at it from the parent — `via` / `cycle` are
 * read off this edge.
 *
 * Returns a flat array of rows in kind-order with dividers inserted
 * between buckets. **Dividers are emitted only when ≥2 buckets are
 * present** — a same-kind list shows no divider clutter, matching the
 * sidebar's `groupAndSort` rule.
 */
export function groupAndSort(
  children: readonly ResolvedNode[],
  edgeByToKey: ReadonlyMap<string, ResolvedEdge>,
): GroupedRow[] {
  const byKind = new Map<DisplayKind, ResolvedNode[]>();
  for (const n of children) {
    const k = displayKindOf(n);
    if (!byKind.has(k)) byKind.set(k, []);
    // biome-ignore lint/style/noNonNullAssertion: just-set above
    byKind.get(k)!.push(n);
  }
  const presentKinds = [...byKind.keys()].sort((a, b) => KIND_ORDER[a] - KIND_ORDER[b]);
  const out: GroupedRow[] = [];
  // Dividers always emit, even when a single kind is present at this level.
  // The original D33 "skip-when-single-kind" carve-out was dropped on
  // 2026-05-19 because it hid structure in deep transitive trees — see
  // lesson 2026-05-19 in `docs/lessons.md`.
  for (const k of presentKinds) {
    // biome-ignore lint/style/noNonNullAssertion: just-pushed above
    const bucket = byKind
      .get(k)!
      .slice()
      .sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
      );
    out.push({ row: "divider", kind: k, label: KIND_LABEL[k], count: bucket.length });
    for (const node of bucket) {
      const edge = edgeByToKey.get(node.key);
      if (edge) out.push({ row: "node", node, edge });
    }
  }
  return out;
}
