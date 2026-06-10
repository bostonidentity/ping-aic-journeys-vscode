// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ConnectionFormData,
  ConnectionFormPayload,
  W2E,
} from "@/webview/connection-form/messages";
import { App } from "@/webview/connection-form/ui/App";

function addPayload(over: Partial<ConnectionFormPayload> = {}): ConnectionFormPayload {
  return { mode: "add", initial: null, existingHosts: [], ...over };
}

function editPayload(over: Partial<ConnectionFormPayload> = {}): ConnectionFormPayload {
  return {
    mode: "edit",
    initial: { kind: "paic", host: "old.example.com", saId: "sa-old", name: "Old" },
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

function saveData(post: W2E): ConnectionFormData {
  return (post as Extract<W2E, { type: "save" }>).data;
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
        data: {
          kind: "paic",
          host: "old.example.com",
          saId: "sa-old",
          name: "Old",
          jwk: undefined,
        },
      },
    ]);
  });

  it("Edit mode allows empty JWK; Save posts a ConnectionFormData with jwk: undefined", () => {
    const { vscode, posts } = makeVscode();
    render(<App vscode={vscode} payload={editPayload()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    expect(posts).toHaveLength(1);
    const data = saveData(posts[0]);
    expect(data.kind).toBe("paic");
    if (data.kind === "paic") expect(data.jwk).toBeUndefined();
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

  // --- D41 Slice 4: kind toggle + on-prem field group ---

  it("switches field groups when the connection-type toggle changes", () => {
    const { vscode } = makeVscode();
    render(<App vscode={vscode} payload={addPayload()} />);
    // Default = PAIC.
    expect(screen.getByLabelText(/Service Account ID/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Admin username/i)).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /On-prem/i }));

    expect(screen.getByLabelText(/Admin username/i)).toBeTruthy();
    expect(screen.getByLabelText(/Admin password/i)).toBeTruthy();
    expect(screen.getByLabelText(/Base URL/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Service Account ID/i)).toBeNull();
  });

  it("on-prem Save requires admin username and password", () => {
    const { vscode, posts } = makeVscode();
    render(<App vscode={vscode} payload={addPayload()} />);
    fireEvent.click(screen.getByRole("radio", { name: /On-prem/i }));
    fireEvent.change(screen.getByLabelText(/Base URL/i), {
      target: { value: "http://openam.example.com:8080" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    expect(screen.getByText("Admin username is required.")).toBeTruthy();
    expect(screen.getByText("Admin password is required.")).toBeTruthy();
    expect(posts).toHaveLength(0);
  });

  it("on-prem Save posts a kind:onprem ConnectionFormData", () => {
    const { vscode, posts } = makeVscode();
    render(<App vscode={vscode} payload={addPayload()} />);
    fireEvent.click(screen.getByRole("radio", { name: /On-prem/i }));
    fireEvent.change(screen.getByLabelText(/Base URL/i), {
      target: { value: "http://openam.example.com:8080" },
    });
    fireEvent.change(screen.getByLabelText(/Admin username/i), { target: { value: "amadmin" } });
    fireEvent.change(screen.getByLabelText(/Admin password/i), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    expect(posts).toEqual([
      {
        type: "save",
        data: {
          kind: "onprem",
          host: "http://openam.example.com:8080",
          username: "amadmin",
          name: undefined,
          password: "secret",
        },
      },
    ]);
  });

  it("edit mode disables the connection-type toggle", () => {
    const { vscode } = makeVscode();
    render(<App vscode={vscode} payload={editPayload()} />);
    expect((screen.getByRole("radio", { name: /PAIC/i }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("radio", { name: /On-prem/i }) as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  it("edit mode pre-fills on-prem fields and shows the on-prem group", () => {
    const { vscode } = makeVscode();
    const payload = editPayload({
      initial: {
        kind: "onprem",
        host: "http://am.example.com:8080",
        username: "amadmin",
        name: "Lab",
      },
      existingHosts: ["http://am.example.com:8080"],
    });
    render(<App vscode={vscode} payload={payload} />);
    expect((screen.getByLabelText(/Admin username/i) as HTMLInputElement).value).toBe("amadmin");
    expect(screen.queryByLabelText(/Service Account ID/i)).toBeNull();
  });
});

// Silence unused-import warning for `vi` (we use it implicitly via fireEvent).
void vi;
