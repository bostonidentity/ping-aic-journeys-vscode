// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JourneyCard } from "@/webview/inspector/ui/cards/JourneyCard";
import type { NodeInfo, NodeRef, SelectPayload } from "@/webview/messages";

// Stub reactflow so the diagram renders deterministically as a few divs
// without ResizeObserver / SVG layout. Tests can target `data-testid=rf-node`.
vi.mock("reactflow", async () => {
  const React = await import("react");
  return {
    default: ({
      nodes,
      onNodeClick,
      nodeTypes,
      children,
    }: {
      nodes: Array<{ id: string; type: string; data: unknown }>;
      onNodeClick?: (e: unknown, n: { id: string; data: unknown }) => void;
      nodeTypes: Record<string, React.ComponentType<{ data: unknown }>>;
      children?: React.ReactNode;
    }) =>
      React.createElement(
        "div",
        { "data-testid": "rf-canvas" },
        nodes.map((n) => {
          const Comp = nodeTypes?.[n.type] ?? "div";
          return React.createElement(
            "div",
            {
              key: n.id,
              "data-testid": `rf-node-${n.id}`,
              onClick: () => onNodeClick?.({}, n),
            },
            React.createElement(Comp, { data: n.data }),
          );
        }),
        children,
      ),
    Background: () => null,
    Controls: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", null, children),
    ControlButton: ({
      children,
      onClick,
      title,
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      title?: string;
    }) => React.createElement("button", { onClick, title }, children),
    Handle: () => null,
    Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
    useNodesState: (initial: unknown) => {
      const [state, setState] = React.useState(initial);
      return [state, setState, () => undefined];
    },
  };
});

const journey = {
  id: "Login",
  enabled: true,
  entryNodeId: "n0",
  description: "Standard sign-in",
  identityResource: "managed/alpha_user",
  nodes: { n0: { nodeType: "ScriptedDecisionNode", connections: {} } },
};

const payload: Extract<SelectPayload, { kind: "journey" }> = {
  kind: "journey",
  uid: "journey:h:alpha:Login",
  host: "openam-tenant.example.forgeblocks.com",
  realmName: "alpha",
  journey,
};

const scripts: NodeRef[] = [{ uid: "script:h:alpha:s-1", label: "AuthDecision", kind: "script" }];
const inners: NodeRef[] = [
  { uid: "inner:h:alpha:PasswordReset:Login", label: "PasswordReset", kind: "innerJourney" },
];
const nodeIndex: Record<string, NodeInfo> = {
  n0: { kind: "script", scriptId: "s-1", uid: "script:h:alpha:s-1" },
};

const noop = () => undefined;

describe("JourneyCard", () => {
  it("renders metadata: id, description, identityResource, entry node, node count", () => {
    render(<JourneyCard payload={payload} deps={null} onPreview={noop} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Login");
    expect(screen.getByText("Standard sign-in")).toBeTruthy();
    expect(screen.getByText("managed/alpha_user")).toBeTruthy();
    expect(screen.getByText("n0")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("renders the 4 runtime flags as raw true/false when defined", () => {
    const payloadWithFlags: Extract<SelectPayload, { kind: "journey" }> = {
      ...payload,
      journey: {
        ...journey,
        innerTreeOnly: false,
        noSession: true,
        mustRun: false,
        transactionalOnly: false,
      },
    };
    render(<JourneyCard payload={payloadWithFlags} deps={null} onPreview={noop} />);
    expect(screen.getByText("innerTreeOnly")).toBeTruthy();
    expect(screen.getByText("noSession")).toBeTruthy();
    expect(screen.getByText("mustRun")).toBeTruthy();
    expect(screen.getByText("transactionalOnly")).toBeTruthy();
    // 3 falses + 1 true → expect 3 "false" rows + 1 "true" row.
    expect(screen.getAllByText("false")).toHaveLength(3);
    expect(screen.getByText("true")).toBeTruthy();
  });

  it("skips flag rows when undefined (no '—' placeholder)", () => {
    render(<JourneyCard payload={payload} deps={null} onPreview={noop} />);
    expect(screen.queryByText("innerTreeOnly")).toBeNull();
    expect(screen.queryByText("noSession")).toBeNull();
    expect(screen.queryByText("mustRun")).toBeNull();
    expect(screen.queryByText("transactionalOnly")).toBeNull();
  });

  it("shows the loading message while deps are pending", () => {
    render(<JourneyCard payload={payload} deps={null} onPreview={noop} />);
    expect(screen.getByText(/Resolving dependencies/)).toBeTruthy();
  });

  it("shows the empty message when deps resolve with no scripts and no inners", () => {
    render(
      <JourneyCard
        payload={payload}
        deps={{
          scripts: [],
          inners: [],
          themes: [],
          emailTemplates: [],
          socialIdps: [],
          nodeIndex: {},
        }}
        onPreview={noop}
      />,
    );
    expect(screen.getByText(/No dependencies discovered/)).toBeTruthy();
  });

  it("renders script + inner-journey links and calls onPreview when clicked", () => {
    const onPreview = vi.fn();
    render(
      <JourneyCard
        payload={payload}
        deps={{
          scripts,
          inners,
          themes: [],
          emailTemplates: [],
          socialIdps: [],
          nodeIndex,
        }}
        onPreview={onPreview}
      />,
    );

    const scriptLink = screen.getByRole("button", { name: "AuthDecision" });
    fireEvent.click(scriptLink);
    expect(onPreview).toHaveBeenLastCalledWith("script:h:alpha:s-1");

    const innerLink = screen.getByRole("button", { name: "PasswordReset" });
    fireEvent.click(innerLink);
    expect(onPreview).toHaveBeenLastCalledWith("inner:h:alpha:PasswordReset:Login");
  });

  it("embeds the journey diagram when nodeIndex is present in deps", () => {
    render(
      <JourneyCard
        payload={payload}
        deps={{
          scripts,
          inners,
          themes: [],
          emailTemplates: [],
          socialIdps: [],
          nodeIndex,
        }}
        onPreview={noop}
      />,
    );
    expect(screen.getByTestId("rf-canvas")).toBeTruthy();
    expect(screen.getByTestId("rf-node-n0")).toBeTruthy();
  });
});
