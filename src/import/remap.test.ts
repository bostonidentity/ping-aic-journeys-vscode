import { describe, expect, it } from "vitest";
import { assertScriptRefsResolved, buildScriptRemap, remapNodeScript } from "./remap";

describe("buildScriptRemap", () => {
  it("maps only bundle→target pairs that actually differ", () => {
    const remap = buildScriptRemap([
      { id: "b1", resolvedTargetId: "t1" }, // name-matched, different UUID → remap
      { id: "b2", resolvedTargetId: "b2" }, // name-matched, same UUID → no entry
      { id: "b3" }, // create (no target) → no entry
    ]);
    expect([...remap]).toEqual([["b1", "t1"]]);
  });

  it("returns an empty map for empty input", () => {
    expect(buildScriptRemap([]).size).toBe(0);
  });
});

describe("remapNodeScript", () => {
  const remap = new Map([["b1", "t1"]]);

  it("rewrites a mapped script ref, preserving other fields", () => {
    const node = {
      _id: "n1",
      _type: { _id: "ScriptedDecisionNode" },
      script: "b1",
      outcomes: ["x"],
    };
    expect(remapNodeScript(node, remap)).toEqual({
      _id: "n1",
      _type: { _id: "ScriptedDecisionNode" },
      script: "t1",
      outcomes: ["x"],
    });
  });

  it("leaves an unmapped (create-path) ref unchanged", () => {
    const node = { _id: "n2", script: "b2" };
    expect(remapNodeScript(node, remap)).toBe(node);
  });

  it("leaves a node with no script ref unchanged", () => {
    const node = { _id: "p1", _type: { _id: "PageNode" } };
    expect(remapNodeScript(node, remap)).toBe(node);
  });
});

describe("assertScriptRefsResolved", () => {
  const remap = new Map([["b1", "t1"]]);

  it("throws when a source (mapped) UUID survives — a missed remap", () => {
    expect(() => assertScriptRefsResolved({ _id: "n1", script: "b1" }, remap)).toThrow(/b1/);
  });

  it("passes for a correctly-remapped target ref", () => {
    expect(() => assertScriptRefsResolved({ _id: "n1", script: "t1" }, remap)).not.toThrow();
  });

  it("passes for a create-path ref not in the map", () => {
    expect(() => assertScriptRefsResolved({ _id: "n2", script: "b2" }, remap)).not.toThrow();
  });

  it("passes for a node with no script ref", () => {
    expect(() => assertScriptRefsResolved({ _id: "p1" }, remap)).not.toThrow();
  });
});
