import { describe, expect, it } from "vitest";
import type { ComponentStatus, ComponentVerdict } from "./compare";
import { assembleJourneyImport } from "./journey-assemble";
import type { JourneyAction, JourneyRole, JourneyUnitPlan } from "./journey-plan";
import type { ImportComponent } from "./parse";
import type { RequiredDepVerdict } from "./preflight";

type Bk = ImportComponent["kind"];

const comp = (kind: Bk, id: string, raw: Record<string, unknown> = {}): ImportComponent => ({
  kind,
  id,
  displayName: id,
  raw: { _id: id, ...raw },
});

const verdict = (
  kind: Bk,
  id: string,
  status: ComponentStatus,
  extra: Partial<ComponentVerdict> = {},
): ComponentVerdict => ({ kind, id, displayName: id, status, ...extra });

const jplan = (
  id: string,
  role: JourneyRole,
  v: "new" | "exists",
  defaultAction: JourneyAction,
  allowedActions: JourneyAction[],
): JourneyUnitPlan => ({ id, displayName: id, role, verdict: v, defaultAction, allowedActions });

const input = (over: Partial<Parameters<typeof assembleJourneyImport>[0]> = {}) => ({
  rawComponents: [],
  verdicts: [],
  gates: [],
  journeyPlans: [],
  selectedLeafKeys: new Set<string>(),
  ...over,
});

describe("assembleJourneyImport — leaves", () => {
  it("includes only selected, writable-kind, New/Differs, non-journey leaves", () => {
    const { plan } = assembleJourneyImport(
      input({
        rawComponents: [
          comp("script", "s1"),
          comp("theme", "t1"),
          comp("theme", "t2"),
          comp("script", "s3"),
        ],
        verdicts: [
          verdict("script", "s1", "new"),
          verdict("theme", "t1", "differs"),
          verdict("theme", "t2", "identical"), // not writable
          verdict("script", "s3", "new"), // not selected
          verdict("journey", "Login", "new"), // journey, never a leaf
        ],
        selectedLeafKeys: new Set(["script:s1", "theme:t1", "theme:t2", "journey:Login"]),
      }),
    );
    expect(plan.leaves.map((i) => [i.component.kind, i.component.id, i.verdict])).toEqual([
      ["script", "s1", "new"],
      ["theme", "t1", "differs"],
    ]);
  });

  it("carries a script's resolvedTargetId onto its WritePlanItem", () => {
    const { plan } = assembleJourneyImport(
      input({
        rawComponents: [comp("script", "s1")],
        verdicts: [verdict("script", "s1", "differs", { resolvedTargetId: "tgt" })],
        selectedLeafKeys: new Set(["script:s1"]),
      }),
    );
    expect(plan.leaves[0].resolvedTargetId).toBe("tgt");
  });
});

describe("assembleJourneyImport — journeys", () => {
  const raws = [comp("journey", "Login"), comp("journey", "MFA"), comp("journey", "New1")];
  const plans = [
    jplan("Login", "subject", "exists", "overwrite", ["overwrite"]),
    jplan("MFA", "inner", "exists", "keep", ["overwrite", "keep"]),
    jplan("New1", "inner", "new", "create", ["create"]),
  ];

  it("uses defaultAction with no override: Keep is skipped, Create/Overwrite included", () => {
    const { plan } = assembleJourneyImport(input({ rawComponents: raws, journeyPlans: plans }));
    expect(plan.journeys.map((j) => j.id)).toEqual(["Login", "New1"]); // MFA (keep) dropped
  });

  it("applies an in-bounds override and clamps an out-of-bounds one to the default", () => {
    const { plan } = assembleJourneyImport(
      input({
        rawComponents: raws,
        journeyPlans: plans,
        // MFA overwrite (allowed) → included; Login keep (NOT allowed for a subject) → clamps to overwrite.
        journeyActions: { MFA: "overwrite", Login: "keep" },
      }),
    );
    expect(plan.journeys.map((j) => j.id).sort()).toEqual(["Login", "MFA", "New1"]);
  });

  it("returns no journeys for a leaf bundle (no journeyPlans)", () => {
    const { plan } = assembleJourneyImport(
      input({
        rawComponents: [comp("script", "s1")],
        verdicts: [verdict("script", "s1", "new")],
        selectedLeafKeys: new Set(["script:s1"]),
      }),
    );
    expect(plan.journeys).toEqual([]);
  });
});

describe("assembleJourneyImport — remap, gates, counts", () => {
  it("builds the script remap from differing script verdicts only", () => {
    const { plan } = assembleJourneyImport(
      input({
        verdicts: [
          verdict("script", "s1", "differs", { resolvedTargetId: "t1" }), // differs → remap
          verdict("script", "s2", "differs", { resolvedTargetId: "s2" }), // same UUID → no entry
          verdict("script", "s3", "new"), // no target → no entry
        ],
      }),
    );
    expect([...plan.scriptRemap]).toEqual([["s1", "t1"]]);
  });

  it("lists missing BLOCKING gates and ignores advisory / present ones", () => {
    const gates: RequiredDepVerdict[] = [
      { kind: "nodeType", name: "PingOneVerifyNode", status: "missing", severity: "blocking" },
      { kind: "innerJourney", name: "Risk", status: "present", severity: "blocking" }, // present
      { kind: "esv", name: "esv.x", status: "missing", severity: "advisory" }, // advisory
    ];
    const { blockingMissing } = assembleJourneyImport(input({ gates }));
    expect(blockingMissing).toEqual(["nodeType:PingOneVerifyNode"]);
  });

  it("counts create / overwrite / keep across leaves and journeys", () => {
    const { counts } = assembleJourneyImport(
      input({
        rawComponents: [
          comp("script", "s1"),
          comp("theme", "t1"),
          comp("journey", "Login"),
          comp("journey", "MFA"),
          comp("journey", "New1"),
        ],
        verdicts: [verdict("script", "s1", "new"), verdict("theme", "t1", "differs")],
        selectedLeafKeys: new Set(["script:s1", "theme:t1"]),
        journeyPlans: [
          jplan("Login", "subject", "exists", "overwrite", ["overwrite"]),
          jplan("New1", "inner", "new", "create", ["create"]),
          jplan("MFA", "inner", "exists", "keep", ["overwrite", "keep"]),
        ],
      }),
    );
    expect(counts).toEqual({ create: 2, overwrite: 2, keep: 1 });
  });
});
