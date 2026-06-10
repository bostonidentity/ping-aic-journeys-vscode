// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConnectionCard } from "@/webview/inspector/ui/cards/ConnectionCard";
import type { SelectPayload } from "@/webview/messages";

const payload: Extract<SelectPayload, { kind: "connection" }> = {
  kind: "connection",
  uid: "connection:h.example.com",
  connection: {
    kind: "paic",
    host: "openam-tenant.example.forgeblocks.com",
    saId: "sa-1",
    name: "Demo",
  },
};

describe("ConnectionCard", () => {
  it("renders the display name in the heading", () => {
    render(<ConnectionCard payload={payload} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Demo");
  });

  it("shows host and saId", () => {
    render(<ConnectionCard payload={payload} />);
    expect(screen.getByText("openam-tenant.example.forgeblocks.com")).toBeTruthy();
    expect(screen.getByText("sa-1")).toBeTruthy();
  });

  it("falls back to host as heading when no name is set", () => {
    const noName: Extract<SelectPayload, { kind: "connection" }> = {
      ...payload,
      connection: { kind: "paic", host: "alt.example.com", saId: "sa-2" },
    };
    render(<ConnectionCard payload={noName} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("alt.example.com");
  });

  it("shows the admin user instead of saId for an on-prem connection", () => {
    const onprem: Extract<SelectPayload, { kind: "connection" }> = {
      ...payload,
      connection: { kind: "onprem", host: "http://openam.example.com:8080", username: "amadmin" },
    };
    render(<ConnectionCard payload={onprem} />);
    expect(screen.getByText("amadmin")).toBeTruthy();
    expect(screen.getByText("Admin user")).toBeTruthy();
    expect(screen.queryByText("Service Account ID")).toBeNull();
  });
});
