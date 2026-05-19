// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Journey } from "@/domain/types";
import { JourneyDiagram } from "@/webview/inspector/ui/diagram/JourneyDiagram";
import { SUCCESS_NODE_ID } from "@/webview/inspector/ui/diagram/layout";
import type { NodeInfo } from "@/webview/messages";

// Stub reactflow — see journey-card.test.tsx for the same shape.
vi.mock("reactflow", async () => {
  const React = await import("react");
  return {
    default: ({
      nodes,
      onNodeClick,
      nodeTypes,
      children,
    }: {
      nodes: Array<{
        id: string;
        type: string;
        data: unknown;
        position?: { x: number; y: number };
      }>;
      onNodeClick?: (e: unknown, n: { id: string; data: unknown }) => void;
      nodeTypes: Record<string, React.ComponentType<{ data: unknown }>>;
      children?: React.ReactNode;
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
              "data-rf-x": String(n.position?.x ?? ""),
              "data-rf-y": String(n.position?.y ?? ""),
              onClick: () => onNodeClick?.({}, n),
            },
            React.createElement(nodeTypes[n.type] ?? "div", { data: n.data }),
          ),
        ),
        children,
      ),
    Background: () => null,
    Controls: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "rf-controls" }, children),
    ControlButton: ({
      children,
      onClick,
      title,
      ...rest
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      title?: string;
      "aria-label"?: string;
    }) => React.createElement("button", { onClick, title, ...rest }, children),
    Handle: () => null,
    Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
    // useNodesState returns [nodes, setNodes, onNodesChange] — for tests we
    // just echo the initial nodes back through state.
    useNodesState: (initial: unknown) => {
      const [state, setState] = React.useState(initial);
      return [state, setState, () => undefined];
    },
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

  it("renders a synthesized Success terminal with the SuccessNode rf-type", () => {
    render(
      <JourneyDiagram
        journey={{
          id: "Login",
          enabled: true,
          entryNodeId: "n1",
          nodes: {
            n1: {
              nodeType: "ScriptedDecisionNode",
              connections: { Success: SUCCESS_NODE_ID },
            },
          },
        }}
        nodeIndex={{ n1: { kind: "other" } }}
        onPreview={noop}
      />,
    );
    expect(screen.getByTestId(`rf-node-${SUCCESS_NODE_ID}`).getAttribute("data-rf-type")).toBe(
      "SuccessNode",
    );
  });

  it("Re-layout button toggles between AIC layout and dagre layout (D32)", () => {
    // Seed the journey with server coordinates so the initial render goes
    // through the D31 server-coords path.
    const j = journey({
      nodes: {
        n1: {
          nodeType: "ScriptedDecisionNode",
          connections: { true: "n2", false: "n3" },
          x: 500,
          y: 500,
        },
        n2: { nodeType: "InnerTreeEvaluatorNode", connections: {}, x: 800, y: 400 },
        n3: { nodeType: "UsernameCollectorNode", connections: {}, x: 800, y: 600 },
      },
    });
    render(<JourneyDiagram journey={j} nodeIndex={nodeIndex} onPreview={noop} />);
    const initialX = screen.getByTestId("rf-node-n1").getAttribute("data-rf-x");
    expect(initialX).toBe(String(500 - 200 / 2)); // server-coords path subtracts NODE_W/2

    // First click: switch to dagre. Button label flips to "Original layout".
    fireEvent.click(screen.getByRole("button", { name: /Re-layout/i }));
    const dagreX = screen.getByTestId("rf-node-n1").getAttribute("data-rf-x");
    expect(dagreX).not.toBe(initialX);
    expect(
      screen.getByRole("button", { name: /Original layout|Use original layout/i }),
    ).toBeTruthy();

    // Second click: switch back to AIC's server-coords layout. n1 returns
    // to its original position.
    fireEvent.click(screen.getByRole("button", { name: /Original layout|Use original layout/i }));
    const restoredX = screen.getByTestId("rf-node-n1").getAttribute("data-rf-x");
    expect(restoredX).toBe(initialX);
    expect(screen.getByRole("button", { name: /Re-layout/i })).toBeTruthy();
  });

  it("renders an Expand toggle that switches to Collapse after click", () => {
    render(<JourneyDiagram journey={journey()} nodeIndex={nodeIndex} onPreview={noop} />);
    const btn = screen.getByRole("button", { name: /Expand/i });
    expect(btn).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Collapse/i })).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: /Collapse/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^⤢ Expand$/ })).toBeNull();
  });

  it("clicking a synthesized terminal does NOT fire onPreview (no uid in nodeIndex)", () => {
    const onPreview = vi.fn();
    render(
      <JourneyDiagram
        journey={{
          id: "Login",
          enabled: true,
          entryNodeId: "n1",
          nodes: {
            n1: {
              nodeType: "ScriptedDecisionNode",
              connections: { Success: SUCCESS_NODE_ID },
            },
          },
        }}
        nodeIndex={{ n1: { kind: "other" } }}
        onPreview={onPreview}
      />,
    );
    fireEvent.click(screen.getByTestId(`rf-node-${SUCCESS_NODE_ID}`));
    expect(onPreview).not.toHaveBeenCalled();
  });
});
