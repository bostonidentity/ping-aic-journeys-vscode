// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InnerJourneyCard } from "@/webview/inspector/ui/cards/InnerJourneyCard";
import type { SelectPayload } from "@/webview/messages";

const payload: Extract<SelectPayload, { kind: "innerJourney" }> = {
  kind: "innerJourney",
  uid: "inner:h:alpha:PasswordReset:Login",
  host: "openam-tenant.example.forgeblocks.com",
  realmName: "alpha",
  journey: { id: "PasswordReset", enabled: true, entryNodeId: "n0", nodes: {} },
  visited: ["Login"],
};

describe("InnerJourneyCard", () => {
  it("renders the inner journey id as the heading", () => {
    render(<InnerJourneyCard payload={payload} deps={null} onNavigate={() => undefined} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("PasswordReset");
  });

  it("shows the ancestor chain", () => {
    render(<InnerJourneyCard payload={payload} deps={null} onNavigate={() => undefined} />);
    expect(screen.getByText("Login")).toBeTruthy();
  });
});
