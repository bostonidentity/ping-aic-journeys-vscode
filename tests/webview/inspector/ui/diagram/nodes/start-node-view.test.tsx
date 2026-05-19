// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StartNodeView } from "@/webview/inspector/ui/diagram/nodes/StartNodeView";

vi.mock("reactflow", () => ({
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

describe("StartNodeView", () => {
  it("renders 'Terminal' kind label + 'Start' label", () => {
    render(
      <StartNodeView
        id={"startNode"}
        type="StartNode"
        data={{ nodeType: "StartNode", isEntry: false, displayName: "Start" }}
        selected={false}
        zIndex={0}
        isConnectable={false}
        xPos={0}
        yPos={0}
        dragging={false}
      />,
    );
    expect(screen.getByText("Terminal")).toBeTruthy();
    expect(screen.getByText("Start")).toBeTruthy();
  });
});
