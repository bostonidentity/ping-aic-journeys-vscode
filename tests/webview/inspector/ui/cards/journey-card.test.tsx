// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JourneyCard } from "@/webview/inspector/ui/cards/JourneyCard";
import type { NodeRef, SelectPayload } from "@/webview/messages";

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

describe("JourneyCard", () => {
  it("renders metadata: id, description, identityResource, entry node, node count", () => {
    render(<JourneyCard payload={payload} deps={null} onNavigate={() => undefined} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Login");
    expect(screen.getByText("Standard sign-in")).toBeTruthy();
    expect(screen.getByText("managed/alpha_user")).toBeTruthy();
    expect(screen.getByText("n0")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("shows the loading message while deps are pending", () => {
    render(<JourneyCard payload={payload} deps={null} onNavigate={() => undefined} />);
    expect(screen.getByText(/Resolving dependencies/)).toBeTruthy();
  });

  it("shows the empty message when deps resolve with no scripts and no inners", () => {
    render(
      <JourneyCard
        payload={payload}
        deps={{ scripts: [], inners: [] }}
        onNavigate={() => undefined}
      />,
    );
    expect(screen.getByText(/No script or inner-tree dependencies/)).toBeTruthy();
  });

  it("renders script + inner-journey links and calls onNavigate when clicked", () => {
    const onNavigate = vi.fn();
    render(<JourneyCard payload={payload} deps={{ scripts, inners }} onNavigate={onNavigate} />);

    const scriptLink = screen.getByRole("button", { name: "AuthDecision" });
    fireEvent.click(scriptLink);
    expect(onNavigate).toHaveBeenLastCalledWith("script:h:alpha:s-1");

    const innerLink = screen.getByRole("button", { name: "PasswordReset" });
    fireEvent.click(innerLink);
    expect(onNavigate).toHaveBeenLastCalledWith("inner:h:alpha:PasswordReset:Login");
  });
});
