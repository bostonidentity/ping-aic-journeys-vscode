// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeviceMatchNodeView } from "@/webview/inspector/ui/diagram/nodes/DeviceMatchNodeView";

vi.mock("reactflow", () => ({
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom" },
}));

describe("DeviceMatchNodeView", () => {
  it("renders the scriptId hint when useScript is on", () => {
    render(
      <DeviceMatchNodeView
        id="n1"
        type="DeviceMatchNode"
        data={{
          displayName: "Match device",
          nodeType: "DeviceMatchNode",
          info: { kind: "script", scriptId: "s-1", useScript: true },
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
    expect(screen.getByText("Device Match")).toBeTruthy();
    expect(screen.getByText("s-1")).toBeTruthy();
  });

  it("renders the 'Script: inactive' hint when useScript=false", () => {
    render(
      <DeviceMatchNodeView
        id="n1"
        type="DeviceMatchNode"
        data={{
          displayName: "Match device",
          nodeType: "DeviceMatchNode",
          info: { kind: "other", rawNodeType: "DeviceMatchNode", useScript: false },
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
