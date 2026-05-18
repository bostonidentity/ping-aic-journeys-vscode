// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
  it("renders the template name in the heading and shows resolution-failed hint when unresolved", () => {
    render(<EmailTemplateCard payload={baseline} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Welcome");
    expect(screen.getByText(/resolution failed/i)).toBeTruthy();
  });

  it("renders enabled flag + subject when the template is resolved", () => {
    render(
      <EmailTemplateCard
        payload={{
          ...baseline,
          template: {
            name: "Welcome",
            enabled: true,
            from: "noreply@example.com",
            subject: { en: "Welcome!" },
          },
        }}
      />,
    );
    expect(screen.getByText("Welcome!")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
  });
});
