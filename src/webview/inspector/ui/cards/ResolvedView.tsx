/**
 * D35 — shared "Dependencies" section component family. Used by JourneyCard
 * (Slice 3) and by InnerJourneyCard / ScriptCard / LibraryScriptCard
 * (Slice 4+). Pure React, no `vscode` coupling. Receives the level-1 deps
 * content (the existing `DepsBlock` / `ScriptDepsBlock` instances) and the
 * resolver-result state, and wraps both in a segmented control.
 *
 * The component owns the local `mode` state. Switching to Full or Flat for
 * the first time triggers `onResolve()`; the parent (App.tsx) posts the
 * `resolveFull` W2E and updates `resolved` via `resolveResult` E2W.
 * Toggling back to Direct does no extra work; toggling Full ↔ Flat with a
 * resolved graph already in hand is also free.
 */

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { ResolvedEdge, ResolvedGraph, ResolvedNode } from "../../../../domain/resolved-graph";
import { type DisplayKind, groupAndSort, iconFor, labelFor as labelForKind } from "./grouping";

export type ResolveMode = "direct" | "full" | "flat";

export type ResolveState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; graph: ResolvedGraph }
  | { status: "err"; message: string };

export interface ResolvedViewProps {
  /** Level-1 deps for Direct mode (e.g. `<DepsBlock>` or `<ScriptDepsBlock>`). */
  directContent: ReactNode;
  resolved: ResolveState;
  /** Triggered when the user switches to Full or Flat with `resolved.status
   * === "idle"`. Parent posts `resolveFull` W2E and updates `resolved`. */
  onResolve: () => void;
  /** Triggered when the user clicks the per-card refresh button. Parent
   * posts `refreshResolved` W2E (which drops this root's cache entry then
   * re-resolves) and sets `resolved.status` back to `"loading"`. */
  onRefresh: () => void;
  /** Card-internal hyperlink routing for Full / Flat rows (per D24).
   * Receives the full `ResolvedNode` so the parent can post a
   * `previewResolved` W2E with kind + id + isLibrary — the resolver's
   * composite keys never match the sidebar `uidIndex`, so the extension
   * builds a `PaicNode` for the descriptor on the fly. */
  onPreviewResolved: (node: ResolvedNode) => void;
}

export function ResolvedView({
  directContent,
  resolved,
  onResolve,
  onRefresh,
  onPreviewResolved,
}: ResolvedViewProps) {
  const [mode, setMode] = useState<ResolveMode>("direct");

  useEffect(() => {
    if ((mode === "full" || mode === "flat") && resolved.status === "idle") {
      onResolve();
    }
  }, [mode, resolved.status, onResolve]);

  const showRefresh = resolved.status === "ok" || resolved.status === "err";

  return (
    <section className="deps">
      <header className="deps-section-header">
        <h2>Dependencies</h2>
        {resolved.status === "ok" && <ResolvedSummary graph={resolved.graph} />}
        <SegmentedControl value={mode} onChange={setMode} />
        {showRefresh && (
          <button
            type="button"
            className="deps-refresh"
            onClick={onRefresh}
            title="Refresh dependencies"
            aria-label="Refresh dependencies"
          >
            ↻
          </button>
        )}
      </header>
      {mode === "direct" && directContent}
      {mode === "full" && (
        <ResolvedTree resolved={resolved} onPreviewResolved={onPreviewResolved} />
      )}
      {mode === "flat" && (
        <ResolvedFlat resolved={resolved} onPreviewResolved={onPreviewResolved} />
      )}
    </section>
  );
}

function SegmentedControl({
  value,
  onChange,
}: {
  value: ResolveMode;
  onChange: (m: ResolveMode) => void;
}) {
  const options: Array<{ mode: ResolveMode; label: string }> = [
    { mode: "direct", label: "Direct" },
    { mode: "full", label: "Full tree" },
    { mode: "flat", label: "Flat" },
  ];
  return (
    <div className="deps-segment-control" role="radiogroup" aria-label="Dependencies view mode">
      {options.map((o) => (
        // biome-ignore lint/a11y/useSemanticElements: button role=radio is the standard segmented-control idiom
        <button
          key={o.mode}
          type="button"
          role="radio"
          aria-checked={o.mode === value}
          className={`deps-segment-button${o.mode === value ? " active" : ""}`}
          onClick={() => onChange(o.mode)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ResolvedSummary({ graph }: { graph: ResolvedGraph }) {
  const nodeCount = Math.max(0, Object.keys(graph.nodes).length - 1);
  const refCount = graph.edges.length;
  return (
    <span className="deps-summary">
      {nodeCount} unique · {refCount} refs
    </span>
  );
}

function ResolvedTree({
  resolved,
  onPreviewResolved,
}: {
  resolved: ResolveState;
  onPreviewResolved: (node: ResolvedNode) => void;
}) {
  if (resolved.status === "loading") {
    return <p className="deps-resolve-loading">Resolving…</p>;
  }
  if (resolved.status === "err") {
    return <p className="deps-resolve-error">Resolve failed: {resolved.message}</p>;
  }
  if (resolved.status !== "ok") return null;

  const graph = resolved.graph;
  const childEdges = graph.edges.filter((e) => e.fromKey === graph.rootKey);
  if (childEdges.length === 0) {
    return (
      <p className="deps-empty">
        <em>No transitive dependencies.</em>
      </p>
    );
  }
  // Compute "first-rendered parent" per node ONCE, in render order, so the
  // tree can mark later occurrences as `(dup)` deterministically.
  const firstParent = computeFirstRenderedParents(graph);
  return (
    <>
      <div className="deps-tree">
        <TreeRows
          graph={graph}
          fromKey={graph.rootKey}
          onPreviewResolved={onPreviewResolved}
          firstParent={firstParent}
        />
      </div>
      <ResolvedFooter graph={graph} />
    </>
  );
}

/** Children of `fromKey` in render order (grouped by kind + alphabetized
 * within kind) along with the inbound edge per child. Shared between the
 * first-rendered-parent pre-pass and the actual render. */
function getOrderedChildren(
  graph: ResolvedGraph,
  fromKey: string,
): { rows: ReturnType<typeof groupAndSort>; edgeByToKey: Map<string, ResolvedEdge> } {
  const edges = graph.edges.filter((e) => e.fromKey === fromKey);
  const children: ResolvedNode[] = [];
  const edgeByToKey = new Map<string, ResolvedEdge>();
  for (const e of edges) {
    const child = graph.nodes[e.toKey];
    if (!child) continue;
    if (!edgeByToKey.has(child.key)) {
      children.push(child);
      edgeByToKey.set(child.key, e);
    }
  }
  return { rows: groupAndSort(children, edgeByToKey), edgeByToKey };
}

/** DFS pre-order traversal in the SAME order the tree will render. For
 * each node key, records the parent key whose edge will display the full
 * subtree. Subsequent occurrences (other parents linking to the same
 * child) render as `(dup)`. The root key maps to itself so a cycle back
 * to the root is rendered as `(dup)` rather than recursing infinitely. */
function computeFirstRenderedParents(graph: ResolvedGraph): Map<string, string> {
  const firstParent = new Map<string, string>();
  firstParent.set(graph.rootKey, graph.rootKey);
  function dfs(parentKey: string): void {
    const { rows } = getOrderedChildren(graph, parentKey);
    for (const row of rows) {
      if (row.row !== "node") continue;
      const childKey = row.node.key;
      if (firstParent.has(childKey)) continue; // already rendered above; this edge will be (dup)
      firstParent.set(childKey, parentKey);
      dfs(childKey);
    }
  }
  dfs(graph.rootKey);
  return firstParent;
}

function TreeRows({
  graph,
  fromKey,
  onPreviewResolved,
  firstParent,
}: {
  graph: ResolvedGraph;
  fromKey: string;
  onPreviewResolved: (node: ResolvedNode) => void;
  firstParent: ReadonlyMap<string, string>;
}) {
  const parentDepth = graph.nodes[fromKey]?.depth ?? 0;
  const childDepth = parentDepth + 1;
  const { rows } = getOrderedChildren(graph, fromKey);
  if (rows.length === 0) return null;

  return (
    <ul className="deps-tree-list">
      {rows.map((row, i) => {
        if (row.row === "divider") {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: dividers have no domain id; their position is the identity
            <li key={`d:${fromKey}:${row.kind}:${i}`} className="deps-tree-divider">
              ── {row.label} ({row.count}, depth {childDepth}) ──
            </li>
          );
        }
        const { node: child } = row;
        // An edge renders as `(dup)` when THIS parent is NOT the first
        // parent the renderer visited for this child. The first-rendered
        // edge always shows the full subtree, every later occurrence is
        // marked dup. Independent of the walker's `edge.cycle` flag —
        // walker uses BFS-discovery order, render uses top-to-bottom
        // groupAndSort order; they can disagree on WHICH edge is "first".
        const isDup = firstParent.get(child.key) !== fromKey;
        const display = displayKindOf(child);
        return (
          <li key={`${fromKey}->${child.key}`} className="deps-tree-row">
            <button type="button" className="link" onClick={() => onPreviewResolved(child)}>
              <i className={`codicon codicon-${iconFor(display)} deps-icon`} aria-hidden />
              <span className="deps-name"> {child.displayName}</span>
            </button>
            {isDup ? (
              <span className="deps-tree-dup"> (dup)</span>
            ) : (
              <TreeRows
                graph={graph}
                fromKey={child.key}
                onPreviewResolved={onPreviewResolved}
                firstParent={firstParent}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ResolvedFlat({
  resolved,
  onPreviewResolved,
}: {
  resolved: ResolveState;
  onPreviewResolved: (node: ResolvedNode) => void;
}) {
  if (resolved.status === "loading") {
    return <p className="deps-resolve-loading">Resolving…</p>;
  }
  if (resolved.status === "err") {
    return <p className="deps-resolve-error">Resolve failed: {resolved.message}</p>;
  }
  if (resolved.status !== "ok") return null;

  const graph = resolved.graph;
  const refCounts = new Map<string, number>();
  for (const e of graph.edges) {
    refCounts.set(e.toKey, (refCounts.get(e.toKey) ?? 0) + 1);
  }
  // Index ONE inbound edge per node (the BFS-discovery edge). Flat view
  // doesn't render edge metadata, but the grouping helper needs to know
  // which nodes appear in the graph.
  const edgeByToKey = new Map<string, ResolvedEdge>();
  for (const e of graph.edges) {
    if (!edgeByToKey.has(e.toKey)) edgeByToKey.set(e.toKey, e);
  }
  const allNodes = Object.values(graph.nodes).filter((n) => n.key !== graph.rootKey);
  const rows = groupAndSort(allNodes, edgeByToKey);

  if (allNodes.length === 0) {
    return (
      <p className="deps-empty">
        <em>No transitive dependencies.</em>
      </p>
    );
  }
  return (
    <>
      <ul className="deps-flat">
        {rows.map((row, i) => {
          if (row.row === "divider") {
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: dividers are position-identified
              <li key={`d:${row.kind}:${i}`} className="deps-flat-divider">
                ── {row.label} ({row.count}) ──
              </li>
            );
          }
          const n = row.node;
          const display = displayKindOf(n);
          return (
            <li key={n.key} className="deps-flat-row">
              <button type="button" className="link" onClick={() => onPreviewResolved(n)}>
                <i className={`codicon codicon-${iconFor(display)} deps-icon`} aria-hidden />
                <span className="deps-name"> {n.displayName}</span>
              </button>
              <span className="deps-flat-meta">
                {" "}
                · {refCounts.get(n.key) ?? 0} refs · depth {n.depth}
              </span>
            </li>
          );
        })}
      </ul>
      <ResolvedFooter graph={graph} />
    </>
  );
}

function ResolvedFooter({ graph }: { graph: ResolvedGraph }) {
  const cycleCount = graph.edges.filter((e) => e.cycle === true).length;
  const maxDepth = Math.max(0, ...Object.values(graph.nodes).map((n) => n.depth));
  return (
    <footer className="deps-resolve-footer">
      Cycles: {cycleCount === 0 ? "none" : cycleCount} · Depth: {maxDepth} · Resolved in{" "}
      {graph.durationMs} ms
    </footer>
  );
}

// Re-export so callers (and other components) can still reach the display
// kind for a node without importing two modules.
function displayKindOf(node: ResolvedNode): DisplayKind {
  // Inline copy of the helper from `./grouping` to avoid a redundant
  // import alias — the helper module already exports `displayKindOf`, but
  // this file's `ResolvedTree` / `ResolvedFlat` rendering uses it inline.
  if (node.kind === "journey") return "innerJourney";
  if (node.kind === "script") return node.isLibrary ? "libraryScript" : "script";
  if (node.kind === "esv") {
    if (node.esvKind === "variable") return "esvVariable";
    if (node.esvKind === "secret") return "esvSecret";
    if (node.esvKind === "missing") return "esvMissing";
    return "esv";
  }
  return node.kind;
}

// Silence unused warning — kept for parity with `groupAndSort` users.
void labelForKind;
