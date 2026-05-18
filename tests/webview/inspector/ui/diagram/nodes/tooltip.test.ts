import { describe, expect, it } from "vitest";
import { buildNodeTooltip } from "@/webview/inspector/ui/diagram/nodes/tooltip";

describe("buildNodeTooltip — Slice 4 branches", () => {
  it("renders the theme line for kind: theme", () => {
    const out = buildNodeTooltip({
      displayName: "Login Page",
      nodeType: "PageNode",
      isEntry: false,
      info: { kind: "theme", themeId: "theme-1", uid: "theme:h:alpha:theme-1" },
    });
    expect(out).toContain("Theme: theme-1");
    expect(out).toContain("Login Page");
  });

  it("renders the template line for kind: emailTemplate", () => {
    const out = buildNodeTooltip({
      displayName: "Send",
      nodeType: "EmailSuspendNode",
      isEntry: false,
      info: { kind: "emailTemplate", emailTemplateName: "Welcome" },
    });
    expect(out).toContain("Template: Welcome");
  });

  it("renders the IdPs line for kind: socialIdp", () => {
    const out = buildNodeTooltip({
      displayName: "Pick",
      nodeType: "SelectIdPNode",
      isEntry: false,
      info: { kind: "socialIdp", socialIdpNames: ["google", "apple"] },
    });
    expect(out).toContain("IdPs: google, apple");
  });

  it("appends Script: inactive when useScript === false", () => {
    const out = buildNodeTooltip({
      displayName: "Verify",
      nodeType: "DeviceMatchNode",
      isEntry: false,
      info: { kind: "other", rawNodeType: "DeviceMatchNode", useScript: false },
    });
    expect(out).toContain("Script: inactive (useScript=false)");
  });

  it("for SocialProviderHandler*-style entries (kind: script + socialIdpNames) lists both Script ID and IdPs", () => {
    const out = buildNodeTooltip({
      displayName: "Social",
      nodeType: "SocialProviderHandlerNode",
      isEntry: false,
      info: {
        kind: "script",
        scriptId: "s-social",
        socialIdpNames: ["google", "apple"],
      },
    });
    expect(out).toContain("Script ID: s-social");
    expect(out).toContain("IdPs: google, apple");
  });
});
