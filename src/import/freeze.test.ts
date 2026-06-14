import { describe, expect, it } from "vitest";
import { PaicError } from "../paic/errors";
import type { ComponentVerdict } from "./compare";
import { detectDrift, diffSnapshots, type FrozenPlan, snapshotState } from "./freeze";
import type { JourneyImportPlan } from "./journey-execute";
import type { ImportComponent } from "./parse";
import type { PreflightClient, RequiredDepVerdict } from "./preflight";

/** A fake `PreflightClient` — everything absent unless overridden (mirrors
 * `preflight.test.ts`). */
function client(over: Record<string, () => Promise<unknown>> = {}): PreflightClient {
  return {
    getRawTheme: async () => null,
    getRawEmailTemplate: async () => null,
    getRawSocialIdp: async () => null,
    getRawScriptByName: async () => null,
    findRawScriptsByName: async () => [],
    getRawScript: () => Promise.reject(new Error("404 not found")),
    getRawEsv: async () => null,
    listVariables: async () => [],
    listSecrets: async () => [],
    getNodeTypes: async () => [],
    listTrees: async () => [],
    getRawJourney: () => Promise.reject(new PaicError("not found", { status: 404 })),
    ...over,
  } as unknown as PreflightClient;
}

const EMPTY_PLAN: JourneyImportPlan = { leaves: [], journeys: [], scriptRemap: new Map() };

const frozen = (over: Partial<FrozenPlan>): FrozenPlan => ({
  realm: "alpha",
  targetKind: "paic",
  rawComponents: [],
  plan: EMPTY_PLAN,
  snapshot: new Map(),
  ...over,
});

describe("snapshotState", () => {
  it("keys components by kind:id and blocking gates by kind:name; drops advisory gates", () => {
    const verdicts: ComponentVerdict[] = [
      { kind: "script", id: "s1", displayName: "s1", status: "differs" },
      { kind: "journey", id: "Login", displayName: "Login", status: "exists" },
    ];
    const gates: RequiredDepVerdict[] = [
      { kind: "nodeType", name: "PageNode", status: "present", severity: "blocking" },
      { kind: "esv", name: "esv.x", status: "missing", severity: "advisory" }, // dropped
    ];
    expect([...snapshotState(verdicts, gates)]).toEqual([
      ["script:s1", "differs"],
      ["journey:Login", "exists"],
      ["nodeType:PageNode", "present"],
    ]);
  });
});

describe("diffSnapshots", () => {
  it("is empty when the snapshots match", () => {
    const m = new Map([["script:s1", "new"]]);
    expect(diffSnapshots(m, new Map([["script:s1", "new"]]))).toEqual([]);
  });

  it("reports changed, added (now-only), and removed (was-only) keys", () => {
    const was = new Map([
      ["chg", "new"],
      ["gone", "present"],
    ]);
    const now = new Map([
      ["chg", "exists"],
      ["added", "present"],
    ]);
    expect(diffSnapshots(was, now).sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: "added", was: "(absent)", now: "present" },
      { key: "chg", was: "new", now: "exists" },
      { key: "gone", was: "present", now: "(absent)" },
    ]);
  });
});

describe("detectDrift", () => {
  const libScript: ImportComponent = {
    kind: "script",
    id: "s1",
    displayName: "s1",
    raw: { _id: "s1", name: "s1", context: "LIBRARY", script: JSON.stringify("// x") },
  };
  const journeyWithNode: ImportComponent = {
    kind: "journey",
    id: "Login",
    displayName: "Login",
    raw: { tree: {}, nodes: { n: { _type: { _id: "PingOneVerifyNode" } } }, innerNodes: {} },
  };

  it("is clean when the re-read matches the frozen snapshot", async () => {
    const report = await detectDrift(
      client(),
      frozen({ rawComponents: [libScript], snapshot: new Map([["script:s1", "new"]]) }),
    );
    expect(report.drifted).toEqual([]);
  });

  it("flags a component whose verdict changed (new → exists)", async () => {
    const report = await detectDrift(
      client({
        findRawScriptsByName: async () =>
          [{ _id: "t1", name: "s1", context: "LIBRARY", script: "" }] as unknown as never,
      }),
      frozen({ rawComponents: [libScript], snapshot: new Map([["script:s1", "new"]]) }),
    );
    expect(report.drifted).toEqual([{ key: "script:s1", was: "new", now: "exists" }]);
  });

  it("flags a blocking gate that vanished (node type present → missing)", async () => {
    const report = await detectDrift(
      client({ getNodeTypes: async () => [] }), // catalog no longer has the node type
      frozen({
        rawComponents: [journeyWithNode],
        snapshot: new Map([
          ["journey:Login", "new"],
          ["nodeType:PingOneVerifyNode", "present"],
        ]),
      }),
    );
    expect(report.drifted).toEqual([
      { key: "nodeType:PingOneVerifyNode", was: "present", now: "missing" },
    ]);
  });
});
