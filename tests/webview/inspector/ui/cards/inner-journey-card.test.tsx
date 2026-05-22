// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InnerJourneyCard } from "@/webview/inspector/ui/cards/InnerJourneyCard";
import type { ResolveState } from "@/webview/inspector/ui/cards/ResolvedView";
import type { NodeInfo, SelectPayload } from "@/webview/messages";

vi.mock("reactflow", async () => {
  const React = await import("react");
  return {
    default: ({
      nodes,
      children,
    }: {
      nodes: Array<{ id: string; type: string; data: unknown }>;
      children?: React.ReactNode;
    }) =>
      React.createElement(
        "div",
        { "data-testid": "rf-canvas" },
        nodes.map((n) =>
          React.createElement("div", { key: n.id, "data-testid": `rf-node-${n.id}` }),
        ),
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

const placeholderPayload: Extract<SelectPayload, { kind: "innerJourney" }> = {
  kind: "innerJourney",
  uid: "inner:h:alpha:PasswordReset:Login",
  host: "openam-tenant.example.forgeblocks.com",
  realmName: "alpha",
  journey: { id: "PasswordReset", enabled: true, entryNodeId: "n0", nodes: {} },
  visited: ["Login"],
};

const fullPayload: Extract<SelectPayload, { kind: "innerJourney" }> = {
  ...placeholderPayload,
  journey: {
    id: "PasswordReset",
    enabled: true,
    entryNodeId: "n0",
    nodes: {
      n0: { nodeType: "ScriptedDecisionNode", connections: {} },
    },
  },
};

const nodeIndex: Record<string, NodeInfo> = {
  n0: { kind: "script", scriptId: "s-1", uid: "script:h:alpha:s-1" },
};

const noop = () => undefined;
const idle: ResolveState = { status: "idle" };

describe("InnerJourneyCard", () => {
  it("renders the inner journey id as the heading", () => {
    render(
      <InnerJourneyCard
        payload={placeholderPayload}
        deps={null}
        resolved={idle}
        onPreview={noop}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("PasswordReset");
  });

  it("shows the ancestor chain", () => {
    render(
      <InnerJourneyCard
        payload={placeholderPayload}
        deps={null}
        resolved={idle}
        onPreview={noop}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.getByText("Login")).toBeTruthy();
  });

  it("does NOT embed a diagram when journey.nodes is empty (placeholder)", () => {
    render(
      <InnerJourneyCard
        payload={placeholderPayload}
        deps={{
          scripts: [],
          inners: [],
          themes: [],
          emailTemplates: [],
          socialIdps: [],
          nodeIndex: {},
        }}
        resolved={idle}
        onPreview={noop}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.queryByTestId("rf-canvas")).toBeNull();
  });

  it("embeds the journey diagram when nodes + nodeIndex are present", () => {
    render(
      <InnerJourneyCard
        payload={fullPayload}
        deps={{
          scripts: [],
          inners: [],
          themes: [],
          emailTemplates: [],
          socialIdps: [],
          nodeIndex,
        }}
        resolved={idle}
        onPreview={noop}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.getByTestId("rf-canvas")).toBeTruthy();
    expect(screen.getByTestId("rf-node-n0")).toBeTruthy();
  });

  // ─── D35 — Dependencies segmented control ──────────────────────────────

  it("renders the Direct / Full tree / Flat segmented control", () => {
    render(
      <InnerJourneyCard
        payload={placeholderPayload}
        deps={null}
        resolved={idle}
        onPreview={noop}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.getByRole("radio", { name: "Direct" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Full tree" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Flat" })).toBeTruthy();
  });

  it("clicking Full tree fires onResolve when status is idle", () => {
    const onResolve = vi.fn();
    render(
      <InnerJourneyCard
        payload={placeholderPayload}
        deps={null}
        resolved={idle}
        onPreview={noop}
        onResolve={onResolve}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Full tree" }));
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it("Find usages button fires onFindUsages with journey kind + id (M5 Slice 3)", () => {
    const onFindUsages = vi.fn();
    render(
      <InnerJourneyCard
        payload={placeholderPayload}
        deps={null}
        resolved={idle}
        onPreview={noop}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
        onFindUsages={onFindUsages}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Find usages/i }));
    expect(onFindUsages).toHaveBeenCalledWith({
      type: "findUsages",
      host: placeholderPayload.host,
      realm: "alpha",
      kind: "journey",
      id: "PasswordReset",
      displayName: "PasswordReset",
    });
  });
});
