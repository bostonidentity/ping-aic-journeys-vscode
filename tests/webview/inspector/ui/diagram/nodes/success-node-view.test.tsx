// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SuccessNodeView } from "@/webview/inspector/ui/diagram/nodes/SuccessNodeView";

vi.mock("reactflow", () => ({
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

describe("SuccessNodeView", () => {
  it("renders 'Terminal' kind label + 'Success' label", () => {
    render(
      <SuccessNodeView
        id={"success"}
        type="SuccessNode"
        data={{ nodeType: "SuccessNode", isEntry: false, displayName: "Success" }}
        selected={false}
        zIndex={0}
        isConnectable={false}
        xPos={0}
        yPos={0}
        dragging={false}
      />,
    );
    expect(screen.getByText("Terminal")).toBeTruthy();
    expect(screen.getByText("Success")).toBeTruthy();
  });
});
