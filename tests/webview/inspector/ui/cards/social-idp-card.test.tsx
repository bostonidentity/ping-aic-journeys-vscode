// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SocialIdpCard } from "@/webview/inspector/ui/cards/SocialIdpCard";
import type { SelectPayload } from "@/webview/messages";

const baseline: Extract<SelectPayload, { kind: "socialIdp" }> = {
  kind: "socialIdp",
  uid: "social-idp:h:alpha:google-oidc",
  host: "openam-tenant.example.forgeblocks.com",
  realmName: "alpha",
  name: "google-oidc",
};

describe("SocialIdpCard", () => {
  it("renders the provider name in the heading and shows resolution-failed hint when unresolved", () => {
    render(<SocialIdpCard payload={baseline} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("google-oidc");
    expect(screen.getByText(/resolution failed/i)).toBeTruthy();
  });

  it("renders provider type + enabled when resolved", () => {
    render(
      <SocialIdpCard
        payload={{
          ...baseline,
          idp: {
            name: "google-oidc",
            type: "googleSocialAuthentication",
            enabled: true,
            realm: "alpha",
          },
        }}
      />,
    );
    expect(screen.getByText("googleSocialAuthentication")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
  });
});
