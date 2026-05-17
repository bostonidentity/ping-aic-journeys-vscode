// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

  it("shows the M2 hint about script-body rendering", () => {
    render(<ScriptCard payload={baseline} />);
    expect(screen.getByText(/Script body rendering arrives in M2/)).toBeTruthy();
  });
});
