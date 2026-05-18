// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfigProviderNodeView } from "@/webview/inspector/ui/diagram/nodes/ConfigProviderNodeView";

vi.mock("reactflow", () => ({
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom" },
}));

describe("ConfigProviderNodeView", () => {
  it("renders the 'Config Provider' kind + scriptId hint", () => {
    render(
      <ConfigProviderNodeView
        id="n1"
        type="ConfigProviderNode"
        data={{
          displayName: "Provider",
          nodeType: "ConfigProviderNode",
          info: { kind: "script", scriptId: "s-cfg" },
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
    expect(screen.getByText("Config Provider")).toBeTruthy();
    expect(screen.getByText("s-cfg")).toBeTruthy();
  });
});
