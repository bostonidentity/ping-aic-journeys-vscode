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

  it("renders 'Default' badge when isDefault=true + colors as swatches + logo image", () => {
    render(
      <ThemeCard
        payload={{
          ...baseline,
          theme: {
            id: "theme-1",
            name: "kyid_mainThemeWithoutBanner",
            realm: "alpha",
            isDefault: true,
            primaryColor: "#3057A4",
            backgroundColor: "#CFE3FF",
            logo: { en: "https://cdn.example/logo.svg" },
            logoAltText: { en: "Brand logo" },
            journeyLayout: "card",
            fontFamily: "Arial",
          },
        }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "kyid_mainThemeWithoutBanner",
    );
    expect(screen.getByText(/Theme · Default/)).toBeTruthy();
    expect(screen.getByText("#3057A4")).toBeTruthy();
    expect(screen.getByText("#CFE3FF")).toBeTruthy();
    expect(screen.getByText("card")).toBeTruthy();
    expect(screen.getByText("Arial")).toBeTruthy();
    const img = screen.getByAltText("Brand logo") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example/logo.svg");
  });

  it("renders linkedTrees list when present", () => {
    render(
      <ThemeCard
        payload={{
          ...baseline,
          theme: {
            id: "theme-1",
            name: "RichTheme",
            realm: "alpha",
            linkedTrees: ["JourneyA", "JourneyB", "JourneyC"],
          },
        }}
      />,
    );
    expect(screen.getByText(/Linked journeys \(3\)/)).toBeTruthy();
    expect(screen.getByText("JourneyA")).toBeTruthy();
    expect(screen.getByText("JourneyB")).toBeTruthy();
    expect(screen.getByText("JourneyC")).toBeTruthy();
  });
});
