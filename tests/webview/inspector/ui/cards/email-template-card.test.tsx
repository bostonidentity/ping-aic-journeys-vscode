// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmailTemplateCard } from "@/webview/inspector/ui/cards/EmailTemplateCard";
import type { SelectPayload } from "@/webview/messages";

const baseline: Extract<SelectPayload, { kind: "emailTemplate" }> = {
  kind: "emailTemplate",
  uid: "email-template:h:alpha:Welcome",
  host: "openam-tenant.example.forgeblocks.com",
  realmName: "alpha",
  name: "Welcome",
};

describe("EmailTemplateCard", () => {
  it("falls back to template name in the heading + shows resolution-failed hint when unresolved", () => {
    render(<EmailTemplateCard payload={baseline} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Welcome");
    expect(screen.getByText(/resolution failed/i)).toBeTruthy();
  });

  it("renders displayName in heading + enabled flag + per-locale subjects", () => {
    render(
      <EmailTemplateCard
        payload={{
          ...baseline,
          template: {
            name: "Welcome",
            enabled: true,
            from: "noreply@example.com",
            displayName: "KYID Welcome",
            description: "Sent on first login",
            defaultLocale: "en",
            mimeType: "text/html",
            subject: { en: "Welcome!", fr: "Bienvenue!" },
          },
        }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("KYID Welcome");
    expect(screen.getByText("Yes")).toBeTruthy();
    expect(screen.getByText("Welcome!")).toBeTruthy();
    expect(screen.getByText("Bienvenue!")).toBeTruthy();
    expect(screen.getByText("noreply@example.com")).toBeTruthy();
    expect(screen.getByText("Sent on first login")).toBeTruthy();
  });

  it("renders an 'Open body' button per locale and posts the right (host, name, locale) on click", () => {
    const onOpenBody = vi.fn();
    render(
      <EmailTemplateCard
        payload={{
          ...baseline,
          template: {
            name: "Welcome",
            enabled: true,
            message: { en: "<h1>hi</h1>", fr: "<h1>salut</h1>" },
          },
        }}
        onOpenBody={onOpenBody}
      />,
    );
    expect(screen.getByText(/Body \(2 locales\)/)).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: /open body/i });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]); // en sorts first
    expect(onOpenBody).toHaveBeenCalledWith(
      "openam-tenant.example.forgeblocks.com",
      "Welcome",
      "en",
    );
  });

  it("shows a 'Disabled' kind badge suffix when enabled=false", () => {
    render(
      <EmailTemplateCard
        payload={{
          ...baseline,
          template: { name: "Welcome", enabled: false },
        }}
      />,
    );
    expect(screen.getByText(/Email template · Disabled/)).toBeTruthy();
  });
});
