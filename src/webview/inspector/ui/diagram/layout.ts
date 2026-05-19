import dagre from "dagre";
import type { Journey } from "../../../../domain/types";

/** Fixed node dimensions — keep in sync with `.diag-node` CSS in panel.ts. */
export const NODE_W = 200;
export const NODE_H = 64;

/** AIC's platform-fixed static nodes. These IDs appear in `staticNodes` on
 * the wire and are referenced by real journey nodes' `connections` (or, for
 * `startNode`, implicitly connects to `entryNodeId`). They are NOT present
 * in `journey.nodes`. We synthesize all three into the layout so the
 * diagram shows where flows begin and end. See D28 in
 * `docs/design-plan.md`. UUIDs verified against frodo-lib captures + AIC
 * wire payloads — do NOT reconstruct from memory. */
export const START_NODE_ID = "startNode";
export const SUCCESS_NODE_ID = "70e691a5-1e33-4ac3-a356-e7b6d60d92e0";
export const FAILURE_NODE_ID = "e301438c-0bd0-429c-ab0c-66126501069a";

function isOutputTerminal(id: string): boolean {
  return id === SUCCESS_NODE_ID || id === FAILURE_NODE_ID;
}

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

/** Dispatch between two layout sources (D31):
 *
 * - **Server coordinates** — when the journey's wire response carries `x`/`y`
 *   on its nodes and (optionally) a `staticNodes` map, render the diagram
 *   verbatim. Matches what the user sees in AIC's admin UI.
 * - **Dagre auto-layout** — fallback when coordinates are missing or all-zero
 *   (API-created journeys, older exports). Identical behavior to the
 *   pre-D31 layout.
 *
 * Both paths produce the same `{ nodes, edges }` shape with synthesized
 * Start/Success/Failure terminals (D28). */
export function computeLayout(journey: Journey): { nodes: LaidOutNode[]; edges: LaidOutEdge[] } {
  return hasUsableServerCoords(journey)
    ? computeServerCoordLayout(journey)
    : computeDagreLayout(journey);
}

function hasUsableServerCoords(journey: Journey): boolean {
  const entry = journey.nodes[journey.entryNodeId];
  if (!entry || entry.x === undefined || entry.y === undefined) return false;
  // Single-node journey where every node is at (0,0) is indistinguishable
  // from a placeholder; require at least one non-zero axis somewhere.
  for (const n of Object.values(journey.nodes)) {
    if ((n.x ?? 0) !== 0 || (n.y ?? 0) !== 0) return true;
  }
  return false;
}

function gatherReferencedOutputTerminals(journey: Journey): Set<string> {
  const referenced = new Set<string>();
  for (const ref of Object.values(journey.nodes)) {
    for (const to of Object.values(ref.connections)) {
      if (isOutputTerminal(to)) referenced.add(to);
    }
  }
  return referenced;
}

function buildEdges(journey: Journey, referencedTerminals: Set<string>): LaidOutEdge[] {
  const hasEntry = journey.entryNodeId !== "" && journey.nodes[journey.entryNodeId] !== undefined;
  const edges: LaidOutEdge[] = [];
  if (hasEntry) {
    edges.push({
      id: `${START_NODE_ID}-start-${journey.entryNodeId}`,
      source: START_NODE_ID,
      target: journey.entryNodeId,
      label: "start",
    });
  }
  for (const [from, ref] of Object.entries(journey.nodes)) {
    for (const [outcome, to] of Object.entries(ref.connections)) {
      if (!journey.nodes[to] && !referencedTerminals.has(to)) continue;
      edges.push({ id: `${from}-${outcome}-${to}`, source: from, target: to, label: outcome });
    }
  }
  return edges;
}

/** Server-coords path (D31): pass the wire's pixel positions through verbatim,
 * using `staticNodes` for the three platform terminals (with a sensible
 * fallback if a referenced terminal isn't in `staticNodes`). */
function computeServerCoordLayout(journey: Journey): {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
} {
  const hasEntry = journey.entryNodeId !== "" && journey.nodes[journey.entryNodeId] !== undefined;
  const referencedOutputTerminals = gatherReferencedOutputTerminals(journey);

  // AIC's coordinates are center-anchored; ReactFlow uses top-left. Subtract
  // half-dimensions so the rendered node sits centered on the wire's (x, y).
  const realNodes: LaidOutNode[] = Object.entries(journey.nodes).map(([id, ref]) => ({
    id,
    x: (ref.x ?? 0) - NODE_W / 2,
    y: (ref.y ?? 0) - NODE_H / 2,
    width: NODE_W,
    height: NODE_H,
    nodeType: ref.nodeType,
    displayName: ref.displayName,
    isEntry: id === journey.entryNodeId,
  }));

  // Fallback position for terminals that ARE referenced but missing from
  // `staticNodes` on the wire. Place them past the rightmost real node, on
  // the vertical midline.
  let fallbackX = 0;
  let fallbackY = 0;
  if (realNodes.length > 0) {
    fallbackX = Math.max(...realNodes.map((n) => n.x)) + NODE_W + 80;
    const ys = realNodes.map((n) => n.y);
    fallbackY = (Math.min(...ys) + Math.max(...ys)) / 2;
  }

  function terminalPos(id: string): { x: number; y: number } {
    const s = journey.staticNodes?.[id];
    if (s) return { x: s.x - NODE_W / 2, y: s.y - NODE_H / 2 };
    return { x: fallbackX, y: fallbackY };
  }

  const startNodes: LaidOutNode[] = [];
  if (hasEntry) {
    const pos = terminalPos(START_NODE_ID);
    startNodes.push({
      id: START_NODE_ID,
      x: pos.x,
      y: pos.y,
      width: NODE_W,
      height: NODE_H,
      nodeType: "StartNode",
      displayName: "Start",
      isEntry: false,
    });
  }

  const outputTerminalNodes: LaidOutNode[] = [...referencedOutputTerminals].map((id) => {
    const pos = terminalPos(id);
    return {
      id,
      x: pos.x,
      y: pos.y,
      width: NODE_W,
      height: NODE_H,
      nodeType: id === SUCCESS_NODE_ID ? "SuccessNode" : "FailureNode",
      displayName: id === SUCCESS_NODE_ID ? "Success" : "Failure",
      isEntry: false,
    };
  });

  return {
    nodes: [...startNodes, ...realNodes, ...outputTerminalNodes],
    edges: buildEdges(journey, referencedOutputTerminals),
  };
}

/** Pure dagre layout. No React, no DOM — testable in isolation. Synthesizes
 * platform-fixed terminal nodes (D28) when any real node has an edge pointing
 * to either of the stable Success/Failure UUIDs. Drops edges whose target is
 * neither in `journey.nodes` nor a referenced terminal.
 *
 * Used as a fallback when the wire response doesn't carry usable coordinates
 * (D31) AND exposed for the "Re-layout with dagre" Controls button (D32),
 * which lets users opt out of the AIC layout on demand. */
export function computeDagreLayout(journey: Journey): {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
} {
  const g = new dagre.graphlib.Graph({ directed: true });
  // LR per D26 — journeys read as authentication flows. ranksep gives edge
  // labels room to breathe in horizontal layout.
  g.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 70, marginx: 12, marginy: 12 });
  g.setDefaultEdgeLabel(() => ({}));

  // Start node is implicit: always render it whenever the journey has a real
  // entry node, and connect it via a synthetic edge to that entry.
  const hasEntry = journey.entryNodeId !== "" && journey.nodes[journey.entryNodeId] !== undefined;

  const referencedOutputTerminals = gatherReferencedOutputTerminals(journey);

  for (const id of Object.keys(journey.nodes)) {
    g.setNode(id, { width: NODE_W, height: NODE_H });
  }
  if (hasEntry) {
    g.setNode(START_NODE_ID, { width: NODE_W, height: NODE_H });
  }
  for (const id of referencedOutputTerminals) {
    g.setNode(id, { width: NODE_W, height: NODE_H });
  }

  // Edges (also need dagre edges for layout).
  const edges = buildEdges(journey, referencedOutputTerminals);
  if (hasEntry) {
    g.setEdge(START_NODE_ID, journey.entryNodeId);
  }
  for (const [from, ref] of Object.entries(journey.nodes)) {
    for (const [, to] of Object.entries(ref.connections)) {
      if (!journey.nodes[to] && !referencedOutputTerminals.has(to)) continue;
      g.setEdge(from, to);
    }
  }

  dagre.layout(g);

  const realNodes: LaidOutNode[] = Object.entries(journey.nodes).map(([id, ref]) => {
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

  // Vertical midpoint of real nodes — terminals anchor here. Pinning terminals
  // to the center makes the entry/exit flow symmetric and predictable across
  // journeys of any shape. Without this, dagre places terminals wherever the
  // algorithm finds room, often offset from center.
  let terminalY = 0;
  if (realNodes.length > 0) {
    const ys = realNodes.map((n) => n.y);
    terminalY = (Math.min(...ys) + Math.max(...ys)) / 2;
  }

  const startNodes: LaidOutNode[] = [];
  if (hasEntry) {
    const n = g.node(START_NODE_ID);
    startNodes.push({
      id: START_NODE_ID,
      x: (n?.x ?? 0) - NODE_W / 2,
      y: terminalY,
      width: NODE_W,
      height: NODE_H,
      nodeType: "StartNode",
      displayName: "Start",
      isEntry: false,
    });
  }

  const outputTerminalNodes: LaidOutNode[] = [...referencedOutputTerminals].map((id) => {
    const n = g.node(id);
    return {
      id,
      x: (n?.x ?? 0) - NODE_W / 2,
      y: terminalY,
      width: NODE_W,
      height: NODE_H,
      nodeType: id === SUCCESS_NODE_ID ? "SuccessNode" : "FailureNode",
      displayName: id === SUCCESS_NODE_ID ? "Success" : "Failure",
      isEntry: false,
    };
  });

  return { nodes: [...startNodes, ...realNodes, ...outputTerminalNodes], edges };
}
