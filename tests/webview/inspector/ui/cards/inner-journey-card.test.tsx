// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InnerJourneyCard } from "@/webview/inspector/ui/cards/InnerJourneyCard";
import type { NodeInfo, SelectPayload } from "@/webview/messages";

vi.mock("reactflow", async () => {
  const React = await import("react");
  return {
    default: ({ nodes }: { nodes: Array<{ id: string; type: string; data: unknown }> }) =>
      React.createElement(
        "div",
        { "data-testid": "rf-canvas" },
        nodes.map((n) =>
          React.createElement("div", { key: n.id, "data-testid": `rf-node-${n.id}` }),
        ),
      ),
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    Position: { Top: "top", Bottom: "bottom" },
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

describe("InnerJourneyCard", () => {
  it("renders the inner journey id as the heading", () => {
    render(
      <InnerJourneyCard
        payload={placeholderPayload}
        deps={null}
        onNavigate={noop}
        onOpenBody={noop}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("PasswordReset");
  });

  it("shows the ancestor chain", () => {
    render(
      <InnerJourneyCard
        payload={placeholderPayload}
        deps={null}
        onNavigate={noop}
        onOpenBody={noop}
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
        onNavigate={noop}
        onOpenBody={noop}
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
        onNavigate={noop}
        onOpenBody={noop}
      />,
    );
    expect(screen.getByTestId("rf-canvas")).toBeTruthy();
    expect(screen.getByTestId("rf-node-n0")).toBeTruthy();
  });
});
