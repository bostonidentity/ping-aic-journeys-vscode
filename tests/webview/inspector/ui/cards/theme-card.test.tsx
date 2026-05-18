// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeCard } from "@/webview/inspector/ui/cards/ThemeCard";
import type { SelectPayload } from "@/webview/messages";

const baseline: Extract<SelectPayload, { kind: "theme" }> = {
  kind: "theme",
  uid: "theme:h:alpha:theme-1",
  host: "openam-tenant.example.forgeblocks.com",
  realmName: "alpha",
  themeId: "theme-1",
};

describe("ThemeCard", () => {
  it("falls back to themeId in the heading when not resolved", () => {
    render(<ThemeCard payload={baseline} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("theme-1");
    expect(screen.getByText(/resolution failed/i)).toBeTruthy();
  });

  it("renders the theme name in the heading when resolved", () => {
    render(
      <ThemeCard
        payload={{
          ...baseline,
          theme: { id: "theme-1", name: "Default", realm: "alpha" },
        }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Default");
  });
});
