// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionFormPayload, W2E } from "@/webview/connection-form/messages";
import { App } from "@/webview/connection-form/ui/App";

function addPayload(over: Partial<ConnectionFormPayload> = {}): ConnectionFormPayload {
  return { mode: "add", initial: null, existingHosts: [], ...over };
}

function editPayload(over: Partial<ConnectionFormPayload> = {}): ConnectionFormPayload {
  return {
    mode: "edit",
    initial: { host: "old.example.com", saId: "sa-old", name: "Old" },
    existingHosts: ["old.example.com"],
    ...over,
  };
}

function makeVscode() {
  const posts: W2E[] = [];
  return {
    posts,
    vscode: { postMessage: (m: W2E) => posts.push(m) },
  };
}

describe("ConnectionForm App", () => {
  it("blocks Save when required fields are empty and surfaces inline errors", () => {
    const { vscode, posts } = makeVscode();
    render(<App vscode={vscode} payload={addPayload()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    expect(screen.getByText("Host is required.")).toBeTruthy();
    expect(screen.getByText("Service Account ID is required.")).toBeTruthy();
    expect(screen.getByText("JWK is required.")).toBeTruthy();
    expect(posts).toHaveLength(0);
  });

  it("blocks Save in Add mode when host matches an existing connection", () => {
    const { vscode, posts } = makeVscode();
    render(
      <App vscode={vscode} payload={addPayload({ existingHosts: ["existing.example.com"] })} />,
    );
    fireEvent.change(screen.getByLabelText(/Host/i), {
      target: { value: "existing.example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Service Account ID/i), {
      target: { value: "sa-1" },
    });
    fireEvent.change(screen.getByLabelText(/Service Account JWK/i), {
      target: { value: '{"placeholder":true}' },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    expect(screen.getByText("A connection with this host already exists.")).toBeTruthy();
    expect(posts).toHaveLength(0);
  });

  it("Edit mode allows saving with the same host as the original (no duplicate error)", () => {
    const { vscode, posts } = makeVscode();
    render(<App vscode={vscode} payload={editPayload()} />);
    // Host is pre-filled with "old.example.com" which is also in existingHosts;
    // Edit mode must allow the user to re-save the original host.
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    expect(screen.queryByText("A connection with this host already exists.")).toBeNull();
    expect(posts).toEqual([
      {
        type: "save",
        data: { host: "old.example.com", saId: "sa-old", name: "Old", jwk: undefined },
      },
    ]);
  });

  it("Edit mode allows empty JWK; Save posts a ConnectionFormData with jwk: undefined", () => {
    const { vscode, posts } = makeVscode();
    render(<App vscode={vscode} payload={editPayload()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    expect(posts).toHaveLength(1);
    expect((posts[0] as Extract<W2E, { type: "save" }>).data.jwk).toBeUndefined();
  });

  it("Test Connection posts validate, then shows ok banner from validateResult", () => {
    const { vscode, posts } = makeVscode();
    render(<App vscode={vscode} payload={addPayload()} />);
    fireEvent.change(screen.getByLabelText(/Host/i), {
      target: { value: "h.example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Service Account ID/i), {
      target: { value: "sa-1" },
    });
    fireEvent.change(screen.getByLabelText(/Service Account JWK/i), {
      target: { value: '{"placeholder":true}' },
    });
    fireEvent.click(screen.getByRole("button", { name: /Test Connection/i }));
    expect(posts).toHaveLength(1);
    const sent = posts[0] as Extract<W2E, { type: "validate" }>;
    expect(sent.type).toBe("validate");
    expect(sent.requestId).toBe(1);
    expect(screen.getByText(/Testing connection/)).toBeTruthy();

    // Echo a successful validateResult back.
    act(() => {
      const ev = new MessageEvent("message", {
        data: {
          type: "validateResult",
          requestId: 1,
          ok: true,
          expiresIn: 60,
          droppedScopes: [],
        },
      });
      window.dispatchEvent(ev);
    });
    expect(screen.getByText(/Connected\. Token valid for 60s/)).toBeTruthy();
  });

  it("ignores stale validateResult messages with mismatched requestId", () => {
    const { vscode } = makeVscode();
    render(<App vscode={vscode} payload={addPayload()} />);
    fireEvent.change(screen.getByLabelText(/Host/i), {
      target: { value: "h.example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Service Account ID/i), {
      target: { value: "sa-1" },
    });
    fireEvent.change(screen.getByLabelText(/Service Account JWK/i), {
      target: { value: '{"placeholder":true}' },
    });
    fireEvent.click(screen.getByRole("button", { name: /Test Connection/i }));
    // Post a result with the WRONG requestId — should be ignored.
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "validateResult",
          requestId: 99,
          ok: true,
          expiresIn: 60,
          droppedScopes: [],
        },
      }),
    );
    // Banner should still be in pending state.
    expect(screen.getByText(/Testing connection/)).toBeTruthy();
    expect(screen.queryByText(/Connected\. Token valid/)).toBeNull();
  });
});

// Silence unused-import warning for `vi` (we use it implicitly via fireEvent).
void vi;
