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
function selectTargetAndPreflight(verdicts: unknown[], requires: unknown[] = []): void {
  pickCombo("target-connection", "paic", "paic.example");
  postToWebview({ type: "realmsResult", host: "paic.example", realms: ["alpha"] });
  pickCombo("target-realm", "alpha", "alpha");
  postToWebview({
    type: "preflightResult",
    host: "paic.example",
    realm: "alpha",
    verdicts,
    requires,
  });
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
      requires: [],
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
      requires: [],
    });
    expect(screen.getByText("Unsupported")).toBeTruthy();
  });

  it("shows the Import button for an ESV variable bundle (variables are writable)", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "v.variable.json", bundle: variableBundle() });
    selectTargetAndPreflight([
      { kind: "variable", id: "esv-x", displayName: "esv.x", status: "new" },
    ]);
    fireEvent.click(screen.getByLabelText("Import esv.x")); // opt in
    expect(screen.getByText(/Import 1 selected/)).toBeTruthy();
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
    expect(screen.getByText(/aren't live until applied/)).toBeTruthy();
    // TD-10: the ESV row's Status now reads the outcome.
    expect(screen.getByText("Created")).toBeTruthy();
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
    fireEvent.click(screen.getByLabelText("Import zzz export test theme")); // opt in
    fireEvent.click(screen.getByText(/Import 1 selected/));
    expect(post).toHaveBeenCalledWith({
      type: "execute",
      host: "paic.example",
      realm: "alpha",
      selected: ["theme:zzzexporttesttheme"],
    });
  });

  it("after a run, the row Status shows the outcome and the table locks (TD-10)", () => {
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
    expect(screen.getByText("Created")).toBeTruthy(); // phase-3 status in the table
    // Locked: the checkbox is disabled and the read-only note appears.
    expect((screen.getByLabelText("Import zzz theme") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/this plan is now read-only/)).toBeTruthy();
  });

  it("shows the Import button for a new script bundle (scripts are writable)", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "s.script.json", bundle: scriptBundle() });
    selectTargetAndPreflight([
      { kind: "script", id: "s", displayName: "RiskDecision", status: "new" },
    ]);
    fireEvent.click(screen.getByLabelText("Import RiskDecision")); // opt in
    expect(screen.getByText(/Import 1 selected/)).toBeTruthy();
    expect(screen.queryByText(/arrives in a later batch/)).toBeNull();
  });

  it("renders discovered deps as info-only rows IN the table (TD-9, folded into TD-8)", () => {
    const { container } = render(
      <App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />,
    );
    postToWebview({ type: "bundleLoaded", fileName: "s.script.json", bundle: scriptBundle() });
    selectTargetAndPreflight(
      [{ kind: "script", id: "s", displayName: "RiskDecision", status: "new" }],
      [
        { kind: "script", name: "fraud-helpers", status: "missing" },
        { kind: "esv", name: "esv.threshold", status: "present", detail: "variable" },
      ],
    );
    // No separate "Requires" section anymore — deps are table rows.
    expect(screen.queryByText(/Requires/)).toBeNull();
    const names = [...container.querySelectorAll(".plan-name")].map((n) => n.textContent);
    expect(names).toContain("RiskDecision");
    expect(names).toContain("fraud-helpers");
    expect(names.some((n) => n?.startsWith("esv.threshold"))).toBe(true);
    expect(screen.getByText("Missing")).toBeTruthy(); // fraud-helpers
    // A dep row is info-only: disabled checkbox, Status carries the existence fact.
    expect((screen.getByLabelText("Import fraud-helpers") as HTMLInputElement).disabled).toBe(true);
  });

  // ─── TD-8 Plan table ───────────────────────────────────────────────────────

  it("renders the grid table headers (no Action column; Review added per TD-11)", () => {
    const { container } = render(
      <App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />,
    );
    postToWebview({ type: "bundleLoaded", fileName: "x", bundle: themeBundle() });
    selectTargetAndPreflight([{ kind: "theme", id: "t", displayName: "zzz theme", status: "new" }]);
    const headers = [...container.querySelectorAll(".plan-col-head")].map((h) => h.textContent);
    expect(headers).toEqual(["Type", "Status", "Name", "Review"]);
  });

  it("TD-10: three-phase Status — New → Create (checked) → reverts on uncheck", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "x", bundle: themeBundle() });
    selectTargetAndPreflight([{ kind: "theme", id: "t", displayName: "zzz theme", status: "new" }]);
    const cb = screen.getByLabelText("Import zzz theme") as HTMLInputElement;
    expect(cb.checked).toBe(false); // opt-in
    expect(screen.getByText("New")).toBeTruthy(); // phase 1
    fireEvent.click(cb);
    expect(screen.getByText("Create")).toBeTruthy(); // phase 2 (pending verb)
    expect(screen.queryByText("New")).toBeNull();
    expect(screen.getByText(/Import 1 selected · 1 create · 0 overwrite/)).toBeTruthy();
    fireEvent.click(cb); // uncheck → reverts to phase 1
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.queryByText("Create")).toBeNull();
  });

  it("TD-10: a differs row shows Differs → Overwrite when checked", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "x", bundle: themeBundle() });
    selectTargetAndPreflight([
      { kind: "theme", id: "t", displayName: "zzz theme", status: "differs" },
    ]);
    expect(screen.getByText("Differs")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Import zzz theme"));
    expect(screen.getByText("Overwrite")).toBeTruthy();
  });

  it("an identical (no-op) row has a disabled checkbox + Status=Identical", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "x", bundle: themeBundle() });
    selectTargetAndPreflight([
      { kind: "theme", id: "t", displayName: "zzz theme", status: "identical" },
    ]);
    const cb = screen.getByLabelText("Import zzz theme") as HTMLInputElement;
    expect(cb.disabled).toBe(true);
    expect(cb.checked).toBe(false);
    expect(screen.getByText("Identical")).toBeTruthy();
  });

  it("an unsupported row has a disabled checkbox and Status=Unsupported", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [ONPREM_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "x", bundle: themeBundle() });
    pickCombo("target-connection", "onprem", "onprem.example");
    postToWebview({ type: "realmsResult", host: "onprem.example", realms: ["root"] });
    pickCombo("target-realm", "root", "root");
    postToWebview({
      type: "preflightResult",
      host: "onprem.example",
      realm: "root",
      verdicts: [{ kind: "theme", id: "t", displayName: "zzz theme", status: "unsupported" }],
      requires: [],
    });
    // Uniform column: disabled (not absent) checkbox.
    expect((screen.getByLabelText("Import zzz theme") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Unsupported")).toBeTruthy();
  });

  it("an id-collision row is blocked (disabled checkbox) + names the occupant (TD-9)", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "s.script.json", bundle: scriptBundle() });
    selectTargetAndPreflight([
      {
        kind: "script",
        id: "U1",
        displayName: "Foo",
        status: "id-collision",
        message: 'UUID U1 is already used by a different script "Bar" on the target',
      },
    ]);
    expect(screen.getByText("ID collision")).toBeTruthy();
    expect((screen.getByLabelText("Import Foo") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/already used by a different script "Bar"/)).toBeTruthy();
  });

  it("select-all checks every actionable row; button counts follow", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "x", bundle: themeBundle() });
    selectTargetAndPreflight([
      { kind: "theme", id: "a", displayName: "aaa", status: "new" },
      { kind: "theme", id: "b", displayName: "bbb", status: "differs" },
      { kind: "theme", id: "c", displayName: "ccc", status: "identical" }, // no-op, not selected
    ]);
    expect(screen.getByText("Nothing selected")).toBeTruthy(); // default off
    fireEvent.click(screen.getByLabelText("Select all"));
    expect(screen.getByText(/Import 2 selected · 1 create · 1 overwrite/)).toBeTruthy();
  });

  it("button counts follow per-row selection; execute carries only checked keys", () => {
    const post = vi.fn();
    render(<App vscode={{ postMessage: post }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "x", bundle: themeBundle() });
    selectTargetAndPreflight([
      { kind: "theme", id: "a", displayName: "aaa", status: "new" },
      { kind: "theme", id: "b", displayName: "bbb", status: "differs" },
    ]);
    fireEvent.click(screen.getByLabelText("Import bbb")); // pick only the differs
    expect(screen.getByText(/Import 1 selected · 0 create · 1 overwrite/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Import 1 selected/));
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "execute", selected: ["theme:b"] }),
    );
  });

  // ─── TD-11 Review column ─────────────────────────────────────────────────

  it("a script differs row shows BOTH Diff + Find usages; clicks post the right messages", () => {
    const post = vi.fn();
    render(<App vscode={{ postMessage: post }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "s.script.json", bundle: scriptBundle() });
    selectTargetAndPreflight([
      {
        kind: "script",
        id: "bundle-uuid",
        displayName: "RiskDecision",
        status: "differs",
        resolvedTargetId: "target-uuid",
      },
    ]);
    fireEvent.click(screen.getByText("Diff"));
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "openDiff",
        bundleKey: "script:bundle-uuid",
        targetScriptId: "target-uuid", // TD-9: the entity we'd overwrite, not the bundle id
      }),
    );
    fireEvent.click(screen.getByText("Find usages"));
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "openFindUsages",
        // Keyed by the TARGET's id (resolvedTargetId), not the bundle id — so it
        // matches the RealmIndex the Search page seeds its dropdown from.
        targetKey: "script:target-uuid",
        targetKind: "script",
      }),
    );
  });

  it("a theme differs row shows ONLY Find usages (Diff is scripts-only, v1)", () => {
    const post = vi.fn();
    render(<App vscode={{ postMessage: post }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "x", bundle: themeBundle() });
    selectTargetAndPreflight([
      { kind: "theme", id: "t", displayName: "my-theme", status: "differs" },
    ]);
    expect(screen.getByText("Find usages")).toBeTruthy();
    expect(screen.queryByText("Diff")).toBeNull();
    // No resolvedTargetId → key falls back to v.id (themes are id-identified).
    fireEvent.click(screen.getByText("Find usages"));
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "openFindUsages",
        targetKey: "theme:t",
        targetKind: "theme",
      }),
    );
  });

  it("non-differs rows (new / identical) have no Review buttons", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "s.script.json", bundle: scriptBundle() });
    selectTargetAndPreflight([
      { kind: "script", id: "a", displayName: "NewOne", status: "new" },
      { kind: "script", id: "b", displayName: "SameOne", status: "identical" },
    ]);
    expect(screen.queryByText("Diff")).toBeNull();
    expect(screen.queryByText("Find usages")).toBeNull();
  });

  it("Review buttons stay live after import locks the table", () => {
    render(<App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />);
    postToWebview({ type: "bundleLoaded", fileName: "s.script.json", bundle: scriptBundle() });
    selectTargetAndPreflight([
      { kind: "script", id: "s", displayName: "RiskDecision", status: "differs" },
    ]);
    postToWebview({
      type: "executeResult",
      host: "paic.example",
      realm: "alpha",
      results: [{ kind: "script", id: "s", displayName: "RiskDecision", status: "overwritten" }],
      summary: "0 created · 1 overwritten · 0 skipped · 0 failed",
    });
    // Table is locked (checkbox disabled) but inspection buttons remain.
    expect((screen.getByLabelText("Import RiskDecision") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Diff")).toBeTruthy();
    expect(screen.getByText("Find usages")).toBeTruthy();
  });

  it("sorts rows by kind then name (script → theme → variable)", () => {
    const { container } = render(
      <App vscode={{ postMessage: vi.fn() }} payload={{ connections: [PAIC_CONN] }} />,
    );
    postToWebview({ type: "bundleLoaded", fileName: "x", bundle: themeBundle() });
    selectTargetAndPreflight([
      { kind: "variable", id: "v", displayName: "vee", status: "new" },
      { kind: "theme", id: "t2", displayName: "bbb", status: "new" },
      { kind: "theme", id: "t1", displayName: "aaa", status: "new" },
      { kind: "script", id: "s", displayName: "ess", status: "new" },
    ]);
    const names = [...container.querySelectorAll(".plan-name")].map((n) => n.textContent);
    expect(names).toEqual(["ess", "aaa", "bbb", "vee"]); // script, theme(a,b), variable
  });
});
