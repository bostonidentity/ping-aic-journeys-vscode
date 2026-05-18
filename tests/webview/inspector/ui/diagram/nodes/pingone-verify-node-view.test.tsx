// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PingOneVerifyCompletionDecisionNodeView } from "@/webview/inspector/ui/diagram/nodes/PingOneVerifyCompletionDecisionNodeView";

vi.mock("reactflow", () => ({
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom" },
}));

describe("PingOneVerifyCompletionDecisionNodeView", () => {
  it("renders kind label + scriptId hint when active", () => {
    render(
      <PingOneVerifyCompletionDecisionNodeView
        id="n1"
        type="PingOneVerifyCompletionDecisionNode"
        data={{
          displayName: "Verify",
          nodeType: "PingOneVerifyCompletionDecisionNode",
          info: { kind: "script", scriptId: "s-verify", useScript: true },
          isEntry: false,
        }}
        selected={false}
        zIndex={0}
        isConnectable={false}
        xPos={0}
        yPos={0}
        dragging={false}
      />,
    );
    expect(screen.getByText("PingOne Verify Completion")).toBeTruthy();
    expect(screen.getByText("s-verify")).toBeTruthy();
  });

  it("renders 'Script: inactive' when useScript=false", () => {
    render(
      <PingOneVerifyCompletionDecisionNodeView
        id="n1"
        type="PingOneVerifyCompletionDecisionNode"
        data={{
          displayName: "Verify",
          nodeType: "PingOneVerifyCompletionDecisionNode",
          info: {
            kind: "other",
            rawNodeType: "PingOneVerifyCompletionDecisionNode",
            useScript: false,
          },
          isEntry: false,
        }}
        selected={false}
        zIndex={0}
        isConnectable={false}
        xPos={0}
        yPos={0}
        dragging={false}
      />,
    );
    expect(screen.getByText(/Script: inactive/)).toBeTruthy();
  });
});
