// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Journey } from "@/domain/types";
import { JourneyDiagram } from "@/webview/inspector/ui/diagram/JourneyDiagram";
import type { NodeInfo } from "@/webview/messages";

// Stub reactflow — see journey-card.test.tsx for the same shape.
vi.mock("reactflow", async () => {
  const React = await import("react");
  return {
    default: ({
      nodes,
      onNodeClick,
      nodeTypes,
    }: {
      nodes: Array<{ id: string; type: string; data: unknown }>;
      onNodeClick?: (e: unknown, n: { id: string; data: unknown }) => void;
      nodeTypes: Record<string, React.ComponentType<{ data: unknown }>>;
    }) =>
      React.createElement(
        "div",
        { "data-testid": "rf-canvas" },
        nodes.map((n) =>
          React.createElement(
            "div",
            {
              key: n.id,
              "data-testid": `rf-node-${n.id}`,
              "data-rf-type": n.type,
              onClick: () => onNodeClick?.({}, n),
            },
            React.createElement(nodeTypes[n.type] ?? "div", { data: n.data }),
          ),
        ),
      ),
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    Position: { Top: "top", Bottom: "bottom" },
  };
});

function journey(over: Partial<Journey> = {}): Journey {
  return {
    id: "Login",
    enabled: true,
    entryNodeId: "n1",
    nodes: {
      n1: { nodeType: "ScriptedDecisionNode", connections: { true: "n2", false: "n3" } },
      n2: { nodeType: "InnerTreeEvaluatorNode", connections: {} },
      n3: { nodeType: "UsernameCollectorNode", connections: {} },
    },
    ...over,
  };
}

const nodeIndex: Record<string, NodeInfo> = {
  n1: { kind: "script", scriptId: "s-1", uid: "script:h:alpha:s-1" },
  n2: { kind: "inner", innerTreeId: "Inner", uid: "inner:h:alpha:Inner" },
  n3: { kind: "other" },
};

const noop = () => undefined;

describe("JourneyDiagram", () => {
  it("renders the empty placeholder when journey.nodes is empty", () => {
    render(<JourneyDiagram journey={journey({ nodes: {} })} nodeIndex={{}} onPreview={noop} />);
    expect(screen.getByText(/No nodes in this journey/)).toBeTruthy();
    expect(screen.queryByTestId("rf-canvas")).toBeNull();
  });

  it("renders one rf-node per journey node and maps unknown kinds to 'Other'", () => {
    render(<JourneyDiagram journey={journey()} nodeIndex={nodeIndex} onPreview={noop} />);
    expect(screen.getByTestId("rf-node-n1").getAttribute("data-rf-type")).toBe(
      "ScriptedDecisionNode",
    );
    expect(screen.getByTestId("rf-node-n2").getAttribute("data-rf-type")).toBe(
      "InnerTreeEvaluatorNode",
    );
    expect(screen.getByTestId("rf-node-n3").getAttribute("data-rf-type")).toBe("Other");
  });

  it("clicking a script node calls onPreview with the script's uid", () => {
    const onPreview = vi.fn();
    render(<JourneyDiagram journey={journey()} nodeIndex={nodeIndex} onPreview={onPreview} />);
    fireEvent.click(screen.getByTestId("rf-node-n1"));
    expect(onPreview).toHaveBeenCalledWith("script:h:alpha:s-1");
  });

  it("clicking an inner-journey node calls onPreview with the inner uid", () => {
    const onPreview = vi.fn();
    render(<JourneyDiagram journey={journey()} nodeIndex={nodeIndex} onPreview={onPreview} />);
    fireEvent.click(screen.getByTestId("rf-node-n2"));
    expect(onPreview).toHaveBeenCalledWith("inner:h:alpha:Inner");
  });

  it("clicking a node with no uid in nodeIndex fires nothing", () => {
    const onPreview = vi.fn();
    render(<JourneyDiagram journey={journey()} nodeIndex={nodeIndex} onPreview={onPreview} />);
    fireEvent.click(screen.getByTestId("rf-node-n3"));
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("maps PageNode to the PageNode rf-type (not Other)", () => {
    render(
      <JourneyDiagram
        journey={{
          id: "Login",
          enabled: true,
          entryNodeId: "p1",
          nodes: { p1: { nodeType: "PageNode", connections: {} } },
        }}
        nodeIndex={{
          p1: { kind: "theme", themeId: "theme-1", uid: "theme:h:alpha:theme-1" },
        }}
        onPreview={noop}
      />,
    );
    expect(screen.getByTestId("rf-node-p1").getAttribute("data-rf-type")).toBe("PageNode");
  });

  it("clicking a theme node fires onPreview with the theme uid", () => {
    const onPreview = vi.fn();
    render(
      <JourneyDiagram
        journey={{
          id: "Login",
          enabled: true,
          entryNodeId: "p1",
          nodes: { p1: { nodeType: "PageNode", connections: {} } },
        }}
        nodeIndex={{
          p1: { kind: "theme", themeId: "theme-1", uid: "theme:h:alpha:theme-1" },
        }}
        onPreview={onPreview}
      />,
    );
    fireEvent.click(screen.getByTestId("rf-node-p1"));
    expect(onPreview).toHaveBeenCalledWith("theme:h:alpha:theme-1");
  });
});
