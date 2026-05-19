// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FailureNodeView } from "@/webview/inspector/ui/diagram/nodes/FailureNodeView";

vi.mock("reactflow", () => ({
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

describe("FailureNodeView", () => {
  it("renders 'Terminal' kind label + 'Failure' label", () => {
    render(
      <FailureNodeView
        id={"failure"}
        type="FailureNode"
        data={{ nodeType: "FailureNode", isEntry: false, displayName: "Failure" }}
        selected={false}
        zIndex={0}
        isConnectable={false}
        xPos={0}
        yPos={0}
        dragging={false}
      />,
    );
    expect(screen.getByText("Terminal")).toBeTruthy();
    expect(screen.getByText("Failure")).toBeTruthy();
  });
});
