// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ParsedBundle } from "@/webview/transfer/messages";
import { App } from "@/webview/transfer/ui/App";

const PAIC_CONN = { host: "paic.example", name: "PAIC", kind: "paic" as const };
const ONPREM_CONN = { host: "onprem.example", name: "AM", kind: "onprem" as const };

function themeBundle(): ParsedBundle {
  return {
    meta: {
      bundleSchemaVersion: "1.0",
      origin: "openam-tenant.example.forgeblocks.com",
      connectionType: "paic",
      realm: "alpha",
      exportDate: "2026-06-11T00:00:00.000Z",
      exportTool: "paic-journeys-vscode",
      exportToolVersion: "0.1.1",
    },
    kind: "theme",
    label: "Theme",
    components: [{ kind: "theme", id: "zzzexporttesttheme", displayName: "zzz export test theme" }],
    inventory: [],
  };
}

function journeyBundle(): ParsedBundle {
  return {
    meta: null,
    kind: "journey",
    label: "Journey bundle (1 tree)",
    components: [{ kind: "journey", id: "j", displayName: "j" }],
    inventory: ["Nodes: 0"],
  };
}

function scriptBundle(): ParsedBundle {
  return {
    meta: null,
    kind: "script",
    label: "Script",
    components: [{ kind: "script", id: "s", displayName: "lib" }],
    inventory: [],
  };
}

function variableBundle(): ParsedBundle {
  return {
    meta: null,
    kind: "variable",
    label: "ESV variable",
    components: [{ kind: "variable", id: "esv-x", displayName: "esv.x", detail: "value: hello" }],
    inventory: [],
  };
}

/** Drive the App to a target-selected + preflight-loaded state with the given verdicts. */
function selectTargetAndPreflight(verdicts: unknown[]): void {
  pickCombo("target-connection", "paic", "paic.example");
  postToWebview({ type: "realmsResult", host: "paic.example", realms: ["alpha"] });
  pickCombo("target-realm", "alpha", "alpha");
  postToWebview({ type: "preflightResult", host: "paic.example", realm: "alpha", verdicts });
}

/** Dispatch an extension→webview message the way the panel's postMessage does. */
function postToWebview(data: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });
}

/** Drive a `Combobox`: focus + type to open/filter, then click the option. */
function pickCombo(id: string, typeText: string, value: string): void {
  const input = document.getElementById(id) as HTMLInputElement;
  act(() => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: typeText } });
  });
  const opt = document.getElementById(`${id}-opt-${value}`);
  if (!opt) throw new Error(`combobox option ${value} not rendered`);
  act(() => {
    fireEvent.mouseDown(opt);
  });
}

describe("Transfer App", () => {
  it("posts pickBundle when Choose bundle is clicked", () => {
    const post = vi.fn();
    render(<App vscode={{ postMessage: post }} payload={{ connections: [] }} />);
    fireEvent.click(screen.getByText("Choose bundle…"));
    expect(post).toHaveBeenCalledWith({ type: "pickBundle" });
  });

  it("renders the Source preview (chip + meta + component) on bundleLoaded", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "x.theme.json", bundle: themeBundle() });
    expect(screen.getByText("Theme")).toBeTruthy(); // type chip
    expect(screen.getByText("zzz export test theme")).toBeTruthy(); // component row
    expect(screen.getByText("alpha")).toBeTruthy(); // meta realm
    expect(screen.getByText("x.theme.json")).toBeTruthy(); // file name
  });

  it("shows an error banner on bundleError", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [] }} />);
    postToWebview({ type: "bundleError", message: "This file isn't valid JSON." });
    expect(screen.getByText("This file isn't valid JSON.")).toBeTruthy();
  });

  it("shows the Target section for a leaf bundle", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "x.theme.json", bundle: themeBundle() });
    expect(screen.getByText("Target")).toBeTruthy();
    expect(screen.getByText("Connection")).toBeTruthy();
  });

  it("shows a deferral note (and no Target) for a journey bundle", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "j.journey.json", bundle: journeyBundle() });
    expect(screen.getByText(/Journey import — target selection/)).toBeTruthy();
    expect(screen.queryByText("Target")).toBeNull();
  });

  it("posts listRealms when a connection is chosen", () => {
    const post = vi.fn();
    render(<App vscode={{ postMessage: post }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "x", bundle: themeBundle() });
    pickCombo("target-connection", "paic", "paic.example");
    expect(post).toHaveBeenCalledWith({ type: "listRealms", host: "paic.example" });
  });

  it("posts runPreflight and shows a pending state once a target is fully selected", () => {
    const post = vi.fn();
    render(<App vscode={{ postMessage: post }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "x", bundle: themeBundle() });
    pickCombo("target-connection", "paic", "paic.example");
    postToWebview({ type: "realmsResult", host: "paic.example", realms: ["alpha"] });
    pickCombo("target-realm", "alpha", "alpha");
    expect(post).toHaveBeenCalledWith({
      type: "runPreflight",
      host: "paic.example",
      realm: "alpha",
    });
    expect(screen.getByText("Checking target…")).toBeTruthy();
  });

  it("renders Plan verdicts from a matching preflightResult", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "x", bundle: themeBundle() });
    pickCombo("target-connection", "paic", "paic.example");
    postToWebview({ type: "realmsResult", host: "paic.example", realms: ["alpha"] });
    pickCombo("target-realm", "alpha", "alpha");
    postToWebview({
      type: "preflightResult",
      host: "paic.example",
      realm: "alpha",
      verdicts: [
        {
          kind: "theme",
          id: "zzzexporttesttheme",
          displayName: "zzz export test theme",
          status: "differs",
        },
      ],
    });
    expect(screen.getByText(/Differs/)).toBeTruthy();
  });

  it("renders an unsupported verdict for a theme on on-prem", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [ONPREM_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "x", bundle: themeBundle() });
    pickCombo("target-connection", "onprem", "onprem.example");
    postToWebview({ type: "realmsResult", host: "onprem.example", realms: ["root"] });
    pickCombo("target-realm", "root", "root");
    postToWebview({
      type: "preflightResult",
      host: "onprem.example",
      realm: "root",
      verdicts: [
        { kind: "theme", id: "t", displayName: "zzz export test theme", status: "unsupported" },
      ],
    });
    expect(screen.getByText(/not supported on on-prem AM/)).toBeTruthy();
  });

  it("shows the Import button for an ESV variable bundle (variables are writable)", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "v.variable.json", bundle: variableBundle() });
    selectTargetAndPreflight([
      { kind: "variable", id: "esv-x", displayName: "esv.x", status: "new" },
    ]);
    expect(screen.getByText(/Import 1 component/)).toBeTruthy();
  });

  it("renders ESV writes as 'pending apply' with the apply-coming hint", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "v.variable.json", bundle: variableBundle() });
    selectTargetAndPreflight([
      { kind: "variable", id: "esv-x", displayName: "esv.x", status: "new" },
    ]);
    postToWebview({
      type: "executeResult",
      host: "paic.example",
      realm: "alpha",
      results: [{ kind: "variable", id: "esv-x", displayName: "esv.x", status: "created" }],
      summary: "1 created · 0 overwritten · 0 skipped · 0 failed",
    });
    expect(screen.getByText(/pending apply/)).toBeTruthy();
    expect(screen.getByText(/aren't live until applied/)).toBeTruthy();
  });

  /** Drive the App through an ESV import so the Apply button is available. */
  function importEsv(post = vi.fn()) {
    render(<App vscode={{ postMessage: post }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "v.variable.json", bundle: variableBundle() });
    selectTargetAndPreflight([
      { kind: "variable", id: "esv-x", displayName: "esv.x", status: "new" },
    ]);
    postToWebview({
      type: "executeResult",
      host: "paic.example",
      realm: "alpha",
      results: [{ kind: "variable", id: "esv-x", displayName: "esv.x", status: "created" }],
      summary: "1 created",
    });
    return post;
  }

  it("shows the Apply ESV changes button after an ESV import and posts applyEsv", () => {
    const post = importEsv();
    fireEvent.click(screen.getByText("Apply ESV changes"));
    expect(post).toHaveBeenCalledWith({ type: "applyEsv", host: "paic.example" });
  });

  it("renders apply progress then the applied result", () => {
    importEsv();
    postToWebview({
      type: "applyProgress",
      host: "paic.example",
      status: "restarting",
      elapsedS: 30,
    });
    expect(screen.getByText(/Applying ESV changes/)).toBeTruthy();
    postToWebview({ type: "applyResult", host: "paic.example", ok: true, elapsedS: 185 });
    expect(screen.getByText(/ESV changes applied/)).toBeTruthy();
  });

  it("keeps apply progress through a realm-dropdown change (host-keyed)", () => {
    importEsv();
    postToWebview({
      type: "applyProgress",
      host: "paic.example",
      status: "restarting",
      elapsedS: 30,
    });
    // Change the realm — the apply is host-scoped, so it must survive.
    postToWebview({ type: "realmsResult", host: "paic.example", realms: ["alpha", "beta"] });
    pickCombo("target-realm", "beta", "beta");
    expect(screen.getByText(/Applying ESV changes/)).toBeTruthy();
  });

  it("shows an Import button for a writable atom bundle and posts execute", () => {
    const post = vi.fn();
    render(<App vscode={{ postMessage: post }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "x", bundle: themeBundle() });
    selectTargetAndPreflight([
      {
        kind: "theme",
        id: "zzzexporttesttheme",
        displayName: "zzz export test theme",
        status: "new",
      },
    ]);
    const btn = screen.getByText(/Import 1 component/);
    fireEvent.click(btn);
    expect(post).toHaveBeenCalledWith({ type: "execute", host: "paic.example", realm: "alpha" });
  });

  it("renders the write log + summary on executeResult", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "x", bundle: themeBundle() });
    selectTargetAndPreflight([{ kind: "theme", id: "t", displayName: "zzz theme", status: "new" }]);
    postToWebview({
      type: "executeResult",
      host: "paic.example",
      realm: "alpha",
      results: [{ kind: "theme", id: "t", displayName: "zzz theme", status: "created" }],
      summary: "1 created · 0 overwritten · 0 skipped · 0 failed",
    });
    expect(screen.getByText(/zzz theme — created/)).toBeTruthy();
    expect(screen.getByText(/1 created · 0 overwritten/)).toBeTruthy();
  });

  it("shows a deferral note (no Import button) for a non-atom leaf bundle", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "s.script.json", bundle: scriptBundle() });
    selectTargetAndPreflight([{ kind: "script", id: "s", displayName: "lib", status: "exists" }]);
    expect(screen.getByText(/Import for script arrives in a later batch/)).toBeTruthy();
    expect(screen.queryByText(/Import 1 component/)).toBeNull();
  });
});
