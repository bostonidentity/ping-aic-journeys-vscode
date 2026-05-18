// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PageNodeView } from "@/webview/inspector/ui/diagram/nodes/PageNodeView";

vi.mock("reactflow", () => ({
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom" },
}));

describe("PageNodeView", () => {
  it("renders kind label + displayName + theme hint when themeId is set", () => {
    render(
      <PageNodeView
        id="n1"
        type="PageNode"
        data={{
          displayName: "Login Page",
          nodeType: "PageNode",
          info: { kind: "theme", themeId: "theme-1", uid: "theme:h:alpha:theme-1" },
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
    expect(screen.getByText("Page")).toBeTruthy();
    expect(screen.getByText("Login Page")).toBeTruthy();
    expect(screen.getByText(/Theme: theme-1/)).toBeTruthy();
  });

  it("omits the theme hint when no themeId is present", () => {
    render(
      <PageNodeView
        id="n1"
        type="PageNode"
        data={{
          displayName: "Plain Page",
          nodeType: "PageNode",
          info: { kind: "other", rawNodeType: "PageNode" },
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
    expect(screen.queryByText(/Theme:/)).toBeNull();
  });
});
