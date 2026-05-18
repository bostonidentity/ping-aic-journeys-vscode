// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClientScriptNodeView } from "@/webview/inspector/ui/diagram/nodes/ClientScriptNodeView";

vi.mock("reactflow", () => ({
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom" },
}));

describe("ClientScriptNodeView", () => {
  it("renders the 'Client Script' kind + scriptId hint", () => {
    render(
      <ClientScriptNodeView
        id="n1"
        type="ClientScriptNode"
        data={{
          displayName: "Client",
          nodeType: "ClientScriptNode",
          info: { kind: "script", scriptId: "s-client" },
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
    expect(screen.getByText("Client Script")).toBeTruthy();
    expect(screen.getByText("s-client")).toBeTruthy();
  });
});
