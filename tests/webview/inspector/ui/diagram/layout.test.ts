import { describe, expect, it } from "vitest";
import type { Journey } from "@/domain/types";
import {
  computeLayout,
  FAILURE_NODE_ID,
  NODE_H,
  NODE_W,
  START_NODE_ID,
  SUCCESS_NODE_ID,
} from "@/webview/inspector/ui/diagram/layout";

function journey(over: Partial<Journey> = {}): Journey {
  return {
    id: "Login",
    enabled: true,
    entryNodeId: "n1",
    nodes: {
      n1: { nodeType: "ScriptedDecisionNode", connections: { true: "n2", false: "n3" } },
      n2: { nodeType: "InnerTreeEvaluatorNode", connections: {} },
      n3: { nodeType: "PageNode", connections: {} },
    },
    ...over,
  };
}

describe("computeLayout", () => {
  it("returns one node per journey node with the right nodeType (plus synthesized Start)", () => {
    const layout = computeLayout(journey());
    expect(layout.nodes).toHaveLength(4); // 3 real + Start
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    expect(byId.get("n1")?.nodeType).toBe("ScriptedDecisionNode");
    expect(byId.get("n2")?.nodeType).toBe("InnerTreeEvaluatorNode");
    expect(byId.get("n3")?.nodeType).toBe("PageNode");
    expect(byId.get(START_NODE_ID)?.nodeType).toBe("StartNode");
    // Width / height are constants the React component depends on.
    for (const n of layout.nodes) {
      expect(n.width).toBe(NODE_W);
      expect(n.height).toBe(NODE_H);
    }
  });

  it("derives edges from NodeRef.connections + the synthetic Start → entry edge", () => {
    const layout = computeLayout(journey());
    expect(layout.edges).toHaveLength(3); // 2 real + start→entry
    const e1 = layout.edges.find((e) => e.target === "n2");
    const e2 = layout.edges.find((e) => e.target === "n3");
    const eStart = layout.edges.find((e) => e.source === START_NODE_ID);
    expect(e1).toEqual({ id: "n1-true-n2", source: "n1", target: "n2", label: "true" });
    expect(e2).toEqual({ id: "n1-false-n3", source: "n1", target: "n3", label: "false" });
    expect(eStart?.target).toBe("n1");
    expect(eStart?.label).toBe("start");
  });

  it("drops orphan edges whose target is neither in journey.nodes nor a terminal", () => {
    const j = journey({
      nodes: {
        n1: {
          nodeType: "ScriptedDecisionNode",
          connections: { true: "non-existent-uuid", false: "n2" },
        },
        n2: { nodeType: "PageNode", connections: {} },
      },
    });
    const layout = computeLayout(j);
    expect(layout.nodes).toHaveLength(3); // n1, n2, Start
    // Edges: Start→n1, n1→n2 (n1→non-existent dropped)
    expect(layout.edges).toHaveLength(2);
    expect(layout.edges.find((e) => e.target === "non-existent-uuid")).toBeUndefined();
  });

  it("flags the entry node and only the entry node", () => {
    const layout = computeLayout(journey({ entryNodeId: "n2" }));
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    expect(byId.get("n2")?.isEntry).toBe(true);
    expect(byId.get("n1")?.isEntry).toBe(false);
    expect(byId.get("n3")?.isEntry).toBe(false);
  });

  it("returns empty arrays for an empty journey.nodes", () => {
    const j = journey({ nodes: {} });
    const layout = computeLayout(j);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
  });

  it("synthesizes a Success terminal when any edge points to SUCCESS_NODE_ID", () => {
    const j = journey({
      nodes: {
        n1: {
          nodeType: "ScriptedDecisionNode",
          connections: { Success: SUCCESS_NODE_ID, Locked: "n2" },
        },
        n2: { nodeType: "PageNode", connections: {} },
      },
    });
    const layout = computeLayout(j);
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    const success = byId.get(SUCCESS_NODE_ID);
    expect(success).toBeDefined();
    expect(success?.nodeType).toBe("SuccessNode");
    expect(success?.displayName).toBe("Success");
    expect(success?.isEntry).toBe(false);
    // Edge to the terminal must NOT be dropped.
    const edgeToSuccess = layout.edges.find((e) => e.target === SUCCESS_NODE_ID);
    expect(edgeToSuccess).toBeDefined();
    expect(edgeToSuccess?.label).toBe("Success");
  });

  it("synthesizes a Failure terminal when any edge points to FAILURE_NODE_ID", () => {
    const j = journey({
      nodes: {
        n1: {
          nodeType: "ScriptedDecisionNode",
          connections: { Failure: FAILURE_NODE_ID },
        },
      },
    });
    const layout = computeLayout(j);
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    const failure = byId.get(FAILURE_NODE_ID);
    expect(failure).toBeDefined();
    expect(failure?.nodeType).toBe("FailureNode");
    expect(failure?.displayName).toBe("Failure");
  });

  it("synthesizes both output terminals when both are referenced", () => {
    const j = journey({
      nodes: {
        n1: {
          nodeType: "ScriptedDecisionNode",
          connections: { Success: SUCCESS_NODE_ID, Failure: FAILURE_NODE_ID },
        },
      },
    });
    const layout = computeLayout(j);
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    expect(byId.get(SUCCESS_NODE_ID)?.nodeType).toBe("SuccessNode");
    expect(byId.get(FAILURE_NODE_ID)?.nodeType).toBe("FailureNode");
    expect(layout.nodes).toHaveLength(4); // Start + n1 + 2 output terminals
    expect(layout.edges).toHaveLength(3); // start→n1, n1→Success, n1→Failure
  });

  it("does NOT synthesize output terminals that are not referenced", () => {
    const layout = computeLayout(journey());
    const ids = new Set(layout.nodes.map((n) => n.id));
    expect(ids.has(SUCCESS_NODE_ID)).toBe(false);
    expect(ids.has(FAILURE_NODE_ID)).toBe(false);
  });

  it("always synthesizes a Start node + start→entry edge when entryNodeId is valid", () => {
    const layout = computeLayout(journey());
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    const start = byId.get(START_NODE_ID);
    expect(start).toBeDefined();
    expect(start?.nodeType).toBe("StartNode");
    expect(start?.displayName).toBe("Start");
    expect(start?.isEntry).toBe(false);
    const startEdge = layout.edges.find((e) => e.source === START_NODE_ID);
    expect(startEdge?.target).toBe("n1");
    expect(startEdge?.label).toBe("start");
  });

  it("does NOT synthesize a Start node when entryNodeId is missing from journey.nodes", () => {
    const j = journey({
      entryNodeId: "ghost",
      nodes: { n1: { nodeType: "PageNode", connections: {} } },
    });
    const layout = computeLayout(j);
    const ids = new Set(layout.nodes.map((n) => n.id));
    expect(ids.has(START_NODE_ID)).toBe(false);
    expect(layout.edges.find((e) => e.source === START_NODE_ID)).toBeUndefined();
  });

  it("server-coords path: uses node x/y verbatim (center-anchored → top-left for ReactFlow)", () => {
    const j = journey({
      nodes: {
        n1: {
          nodeType: "ScriptedDecisionNode",
          connections: { true: "n2", false: "n3" },
          x: 455,
          y: 137,
        },
        n2: { nodeType: "InnerTreeEvaluatorNode", connections: {}, x: 700, y: 80 },
        n3: { nodeType: "PageNode", connections: {}, x: 700, y: 220 },
      },
    });
    const layout = computeLayout(j);
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    expect(byId.get("n1")?.x).toBe(455 - NODE_W / 2);
    expect(byId.get("n1")?.y).toBe(137 - NODE_H / 2);
    expect(byId.get("n2")?.x).toBe(700 - NODE_W / 2);
    expect(byId.get("n3")?.y).toBe(220 - NODE_H / 2);
  });

  it("server-coords path: uses staticNodes for terminal positions", () => {
    const j = journey({
      nodes: {
        n1: {
          nodeType: "DataStoreDecisionNode",
          connections: { true: SUCCESS_NODE_ID, false: FAILURE_NODE_ID },
          x: 210,
          y: 100,
        },
      },
      staticNodes: {
        startNode: { x: 70, y: 100 },
        [SUCCESS_NODE_ID]: { x: 700, y: 50 },
        [FAILURE_NODE_ID]: { x: 700, y: 150 },
      },
    });
    const layout = computeLayout(j);
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    expect(byId.get(START_NODE_ID)?.x).toBe(70 - NODE_W / 2);
    expect(byId.get(START_NODE_ID)?.y).toBe(100 - NODE_H / 2);
    expect(byId.get(SUCCESS_NODE_ID)?.x).toBe(700 - NODE_W / 2);
    expect(byId.get(SUCCESS_NODE_ID)?.y).toBe(50 - NODE_H / 2);
    expect(byId.get(FAILURE_NODE_ID)?.x).toBe(700 - NODE_W / 2);
    expect(byId.get(FAILURE_NODE_ID)?.y).toBe(150 - NODE_H / 2);
  });

  it("falls back to dagre when no real node has a non-zero coord", () => {
    // The default `journey()` factory has no x/y on any node → server-coords
    // detection fails. We assert by verifying that the laid-out node
    // positions match dagre's deterministic output rather than anything we'd
    // expect from server coords (which would be zero-anchored here).
    const layout = computeLayout(journey());
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    // dagre's LR layout places nodes at distinct x positions; if server
    // coords were used, every node would be at (-NODE_W/2, -NODE_H/2).
    const distinctXs = new Set(layout.nodes.map((n) => n.x));
    expect(distinctXs.size).toBeGreaterThan(1);
    // Entry stays leftmost — dagre puts the synthesized Start node at the
    // smallest x (it has no inbound edges).
    const start = byId.get(START_NODE_ID);
    expect(start).toBeDefined();
    const xs = [...layout.nodes.map((n) => n.x)];
    expect(start?.x).toBe(Math.min(...xs));
  });
});
