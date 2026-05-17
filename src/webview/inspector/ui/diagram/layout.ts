import dagre from "dagre";
import type { Journey } from "../../../../domain/types";

/** Fixed node dimensions — keep in sync with `.diag-node` CSS in panel.ts. */
export const NODE_W = 200;
export const NODE_H = 64;

export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeType: string;
  displayName?: string;
  /** True for the node whose id equals `journey.entryNodeId`. */
  isEntry: boolean;
}

export interface LaidOutEdge {
  id: string;
  source: string;
  target: string;
  /** AIC outcome name on the edge (e.g. "true", "false", "default"). */
  label: string;
}

/** Pure dagre layout. No React, no DOM — testable in isolation. Drops edges
 * whose target node isn't in `journey.nodes` (defensive against orphan refs). */
export function computeLayout(journey: Journey): { nodes: LaidOutNode[]; edges: LaidOutEdge[] } {
  const g = new dagre.graphlib.Graph({ directed: true });
  g.setGraph({ rankdir: "TB", nodesep: 30, ranksep: 48, marginx: 12, marginy: 12 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const id of Object.keys(journey.nodes)) {
    g.setNode(id, { width: NODE_W, height: NODE_H });
  }

  const edges: LaidOutEdge[] = [];
  for (const [from, ref] of Object.entries(journey.nodes)) {
    for (const [outcome, to] of Object.entries(ref.connections)) {
      if (!journey.nodes[to]) continue;
      edges.push({ id: `${from}-${outcome}-${to}`, source: from, target: to, label: outcome });
      g.setEdge(from, to);
    }
  }

  dagre.layout(g);

  const nodes: LaidOutNode[] = Object.entries(journey.nodes).map(([id, ref]) => {
    const n = g.node(id);
    return {
      id,
      x: (n?.x ?? 0) - NODE_W / 2,
      y: (n?.y ?? 0) - NODE_H / 2,
      width: NODE_W,
      height: NODE_H,
      nodeType: ref.nodeType,
      displayName: ref.displayName,
      isEntry: id === journey.entryNodeId,
    };
  });

  return { nodes, edges };
}
