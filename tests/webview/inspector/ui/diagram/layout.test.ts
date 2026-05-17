import { describe, expect, it } from "vitest";
import type { Journey } from "@/domain/types";
import { computeLayout, NODE_H, NODE_W } from "@/webview/inspector/ui/diagram/layout";

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
  it("returns one node per journey node with the right nodeType", () => {
    const layout = computeLayout(journey());
    expect(layout.nodes).toHaveLength(3);
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    expect(byId.get("n1")?.nodeType).toBe("ScriptedDecisionNode");
    expect(byId.get("n2")?.nodeType).toBe("InnerTreeEvaluatorNode");
    expect(byId.get("n3")?.nodeType).toBe("PageNode");
    // Width / height are constants the React component depends on.
    for (const n of layout.nodes) {
      expect(n.width).toBe(NODE_W);
      expect(n.height).toBe(NODE_H);
    }
  });

  it("derives edges from NodeRef.connections with outcome name as label", () => {
    const layout = computeLayout(journey());
    expect(layout.edges).toHaveLength(2);
    const e1 = layout.edges.find((e) => e.target === "n2");
    const e2 = layout.edges.find((e) => e.target === "n3");
    expect(e1).toEqual({ id: "n1-true-n2", source: "n1", target: "n2", label: "true" });
    expect(e2).toEqual({ id: "n1-false-n3", source: "n1", target: "n3", label: "false" });
  });

  it("drops orphan edges whose target is not in journey.nodes", () => {
    const j = journey({
      nodes: {
        n1: { nodeType: "ScriptedDecisionNode", connections: { true: "missing", false: "n2" } },
        n2: { nodeType: "PageNode", connections: {} },
      },
    });
    const layout = computeLayout(j);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]?.target).toBe("n2");
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
});
