// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EsvCard } from "@/webview/inspector/ui/cards/EsvCard";
import type { SelectPayload } from "@/webview/messages";

const payload: Extract<SelectPayload, { kind: "esv" }> = {
  kind: "esv",
  uid: "esv:h:alpha:PUBLIC_URL",
  host: "openam-tenant.example.forgeblocks.com",
  realmName: "alpha",
  name: "PUBLIC_URL",
};

describe("EsvCard", () => {
  it("renders the ESV name in the heading when unresolved + shows the failure hint", () => {
    render(<EsvCard payload={payload} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("PUBLIC_URL");
    expect(screen.getByText(/resolution failed/i)).toBeTruthy();
  });

  it("renders variable kind + expression type when resolved", () => {
    render(
      <EsvCard
        payload={{
          ...payload,
          esv: {
            kind: "variable",
            name: "PUBLIC_URL",
            description: "Public URL",
            expressionType: "string",
          },
        }}
      />,
    );
    expect(screen.getByText("Variable")).toBeTruthy();
    expect(screen.getByText("string")).toBeTruthy();
    expect(screen.getByText("Public URL")).toBeTruthy();
  });

  it("renders secret kind + encoding when resolved as a secret", () => {
    render(
      <EsvCard
        payload={{
          ...payload,
          esv: { kind: "secret", name: "PUBLIC_URL", encoding: "base64" },
        }}
      />,
    );
    expect(screen.getByText("Secret")).toBeTruthy();
    expect(screen.getByText("base64")).toBeTruthy();
  });
});
