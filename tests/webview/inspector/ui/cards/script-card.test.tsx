// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScriptCard } from "@/webview/inspector/ui/cards/ScriptCard";
import type { SelectPayload } from "@/webview/messages";

const baseline: Extract<SelectPayload, { kind: "script" }> = {
  kind: "script",
  uid: "script:h:alpha:s-1",
  host: "openam-tenant.example.forgeblocks.com",
  realmName: "alpha",
  scriptId: "s-1",
};

describe("ScriptCard", () => {
  it("falls back to scriptId in the heading when the script body isn't fetched", () => {
    render(<ScriptCard payload={baseline} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("s-1");
  });

  it("uses the script name and shows language when present", () => {
    render(
      <ScriptCard
        payload={{
          ...baseline,
          script: { id: "s-1", name: "AuthDecision", language: "JAVASCRIPT", body: "" },
        }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("AuthDecision");
    expect(screen.getByText("JAVASCRIPT")).toBeTruthy();
  });

  it("renders no Open-body action when onOpenBody is not provided", () => {
    render(<ScriptCard payload={baseline} />);
    expect(screen.queryByRole("button", { name: /Open body in editor/ })).toBeNull();
  });

  it("calls onOpenBody with host / realm / scriptId / language when the button is clicked", () => {
    const onOpenBody = vi.fn();
    render(
      <ScriptCard
        payload={{
          ...baseline,
          script: { id: "s-1", name: "AuthDecision", language: "JAVASCRIPT", body: "" },
        }}
        onOpenBody={onOpenBody}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Open body in editor/ }));
    expect(onOpenBody).toHaveBeenCalledWith(
      "openam-tenant.example.forgeblocks.com",
      "alpha",
      "s-1",
      "JAVASCRIPT",
    );
  });
});
