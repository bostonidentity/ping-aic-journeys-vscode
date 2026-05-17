// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RealmCard } from "@/webview/inspector/ui/cards/RealmCard";
import type { SelectPayload } from "@/webview/messages";

function payload(active: boolean): Extract<SelectPayload, { kind: "realm" }> {
  return {
    kind: "realm",
    uid: "realm:h:alpha",
    host: "openam-tenant.example.forgeblocks.com",
    realm: { name: "alpha", active, parentPath: "/" },
  };
}

describe("RealmCard", () => {
  it("renders realm name as heading", () => {
    render(<RealmCard payload={payload(true)} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("alpha");
  });

  it("shows Active for an active realm", () => {
    render(<RealmCard payload={payload(true)} />);
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("shows Inactive for a disabled realm", () => {
    render(<RealmCard payload={payload(false)} />);
    expect(screen.getByText("Inactive")).toBeTruthy();
  });
});
