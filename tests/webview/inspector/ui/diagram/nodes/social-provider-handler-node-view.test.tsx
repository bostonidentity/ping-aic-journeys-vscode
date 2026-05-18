// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SocialProviderHandlerNodeView } from "@/webview/inspector/ui/diagram/nodes/SocialProviderHandlerNodeView";

vi.mock("reactflow", () => ({
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom" },
}));

describe("SocialProviderHandlerNodeView", () => {
  it("renders 'Social Provider' kind + truncated IdP hint for 3+ providers", () => {
    render(
      <SocialProviderHandlerNodeView
        id="n1"
        type="SocialProviderHandlerNode"
        data={{
          displayName: "Social",
          nodeType: "SocialProviderHandlerNode",
          info: {
            kind: "script",
            scriptId: "s-1",
            socialIdpNames: ["google", "apple", "facebook"],
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
    expect(screen.getByText("Social Provider")).toBeTruthy();
    expect(screen.getByText(/IdPs \(3\): google, apple, …/)).toBeTruthy();
  });

  it("renders V2 kind label when nodeType is V2", () => {
    render(
      <SocialProviderHandlerNodeView
        id="n2"
        type="SocialProviderHandlerNodeV2"
        data={{
          displayName: "Social V2",
          nodeType: "SocialProviderHandlerNodeV2",
          info: { kind: "socialIdp", socialIdpNames: ["google"] },
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
    expect(screen.getByText("Social Provider (V2)")).toBeTruthy();
    expect(screen.getByText(/IdPs: google/)).toBeTruthy();
  });
});
