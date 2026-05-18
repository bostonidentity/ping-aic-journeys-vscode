// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SelectIdPNodeView } from "@/webview/inspector/ui/diagram/nodes/SelectIdPNodeView";

vi.mock("reactflow", () => ({
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom" },
}));

describe("SelectIdPNodeView", () => {
  it("renders 'Select IdP' kind + IdP hint", () => {
    render(
      <SelectIdPNodeView
        id="n1"
        type="SelectIdPNode"
        data={{
          displayName: "Pick provider",
          nodeType: "SelectIdPNode",
          info: { kind: "socialIdp", socialIdpNames: ["google", "apple"] },
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
    expect(screen.getByText("Select IdP")).toBeTruthy();
    expect(screen.getByText(/IdPs: google, apple/)).toBeTruthy();
  });
});
