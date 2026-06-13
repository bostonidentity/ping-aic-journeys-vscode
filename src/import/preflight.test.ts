import { describe, expect, it, vi } from "vitest";
import type { DiscoveredRef } from "./discover";
import type { ImportComponent } from "./parse";
import {
  discoverDeps,
  missingDepsNote,
  type PreflightClient,
  type RequiredDepVerdict,
  runPreflight,
} from "./preflight";

/** A fake `PreflightClient` — all accessors return `null`/`[]` (absent) unless
 * overridden. Overrides return plain objects (cast through `unknown`). */
function client(over: Record<string, () => Promise<unknown>> = {}): PreflightClient {
  return {
    getRawTheme: async () => null,
    getRawEmailTemplate: async () => null,
    getRawSocialIdp: async () => null,
    getRawScriptByName: async () => null,
    findRawScriptsByName: async () => [],
    getRawEsv: async () => null,
    listVariables: async () => [],
    listSecrets: async () => [],
    ...over,
  } as unknown as PreflightClient;
}

const comp = (over: Partial<ImportComponent>): ImportComponent => ({
  kind: "theme",
  id: "t",
  displayName: "T",
  raw: {},
  ...over,
});

describe("runPreflight", () => {
  it("unsupported (and no fetch) for an IDM leaf on an on-prem target", async () => {
    const getRawTheme = vi.fn(async () => null);
    const v = await runPreflight(client({ getRawTheme }), "root", "onprem", [
      comp({ kind: "theme" }),
    ]);
    expect(v[0].status).toBe("unsupported");
    expect(getRawTheme).not.toHaveBeenCalled();
  });

  it("new when the accessor returns null", async () => {
    const v = await runPreflight(client(), "alpha", "paic", [
      comp({ kind: "theme", raw: { backgroundColor: "#1" } }),
    ]);
    expect(v[0].status).toBe("new");
  });

  it("identical / differs for a value-compared theme", async () => {
    const same = await runPreflight(
      client({ getRawTheme: async () => ({ _id: "z", _rev: "9", backgroundColor: "#1" }) }),
      "alpha",
      "paic",
      [comp({ kind: "theme", id: "t", raw: { _id: "t", backgroundColor: "#1" } })],
    );
    expect(same[0].status).toBe("identical");

    const diff = await runPreflight(
      client({ getRawTheme: async () => ({ backgroundColor: "#2" }) }),
      "alpha",
      "paic",
      [comp({ kind: "theme", raw: { backgroundColor: "#1" } })],
    );
    expect(diff[0].status).toBe("differs");
  });

  it("library script existence via findRawScriptsByName → exists; carries resolved id", async () => {
    const findRawScriptsByName = vi.fn(async () => [{ _id: "target-uuid", name: "lib" }]);
    const v = await runPreflight(client({ findRawScriptsByName }), "alpha", "paic", [
      comp({ kind: "script", id: "bundle-uuid", raw: { name: "lib", context: "LIBRARY" } }),
    ]);
    expect(v[0].status).toBe("exists");
    expect(v[0].resolvedTargetId).toBe("target-uuid"); // TD-9: write reconciles to this
    expect(v[0].targetMatchCount).toBe(1);
    expect(findRawScriptsByName).toHaveBeenCalledWith("alpha", "lib");
  });

  it("decision script value-compares → differs on body (matched by name)", async () => {
    const findRawScriptsByName = vi.fn(async () => [
      { _id: "s", name: "d", script: Buffer.from("// b", "utf8").toString("base64") },
    ]);
    const v = await runPreflight(client({ findRawScriptsByName }), "alpha", "paic", [
      comp({ kind: "script", id: "s", raw: { name: "d", script: JSON.stringify("// a") } }),
    ]);
    expect(v[0].status).toBe("differs");
  });

  it("script absent on target → new, no resolved id", async () => {
    const v = await runPreflight(client(), "alpha", "paic", [
      comp({ kind: "script", id: "s", raw: { name: "d", script: JSON.stringify("// a") } }),
    ]);
    expect(v[0].status).toBe("new");
    expect(v[0].resolvedTargetId).toBeUndefined();
    expect(v[0].targetMatchCount).toBe(0);
  });

  it("dup-named script on target → match count > 1 (first hit drives compare)", async () => {
    const findRawScriptsByName = vi.fn(async () => [
      { _id: "first", name: "d", script: Buffer.from("x", "utf8").toString("base64") },
      { _id: "second", name: "d" },
    ]);
    const v = await runPreflight(client({ findRawScriptsByName }), "alpha", "paic", [
      comp({ kind: "script", id: "s", raw: { name: "d", script: JSON.stringify("x") } }),
    ]);
    expect(v[0].resolvedTargetId).toBe("first");
    expect(v[0].targetMatchCount).toBe(2);
  });

  it("variable/secret discovered-kind mismatch → new", async () => {
    // The bundle is a secret, but getRawEsv discovers a variable of that name.
    const v = await runPreflight(
      client({ getRawEsv: async () => ({ kind: "variable", raw: { _id: "esv-x" } }) }),
      "alpha",
      "paic",
      [comp({ kind: "secret", id: "esv-x", raw: {} })],
    );
    expect(v[0].status).toBe("new");
  });

  it("variable existence when the discovered kind matches → exists", async () => {
    const v = await runPreflight(
      client({ getRawEsv: async () => ({ kind: "variable", raw: { _id: "esv-x" } }) }),
      "alpha",
      "paic",
      [comp({ kind: "variable", id: "esv-x", raw: {} })],
    );
    expect(v[0].status).toBe("exists");
  });

  it("a throwing accessor → error verdict (not a blank plan)", async () => {
    const v = await runPreflight(
      client({ getRawTheme: () => Promise.reject(new Error("boom")) }),
      "alpha",
      "paic",
      [comp({ kind: "theme" })],
    );
    expect(v[0].status).toBe("error");
    expect(v[0].message).toContain("boom");
  });

  it("multi-component bundle → one verdict per component", async () => {
    const v = await runPreflight(client(), "alpha", "paic", [comp({ id: "a" }), comp({ id: "b" })]);
    expect(v).toHaveLength(2);
  });
});

describe("discoverDeps", () => {
  const libRef: DiscoveredRef = { kind: "script", name: "fraud-helpers" };
  const esvRef: DiscoveredRef = { kind: "esv", name: "esv.threshold" };

  it("returns [] for no refs (and makes no calls)", async () => {
    const listVariables = vi.fn(async () => []);
    expect(await discoverDeps(client({ listVariables }), "alpha", [])).toEqual([]);
    expect(listVariables).not.toHaveBeenCalled();
  });

  it("library ref present on target → present", async () => {
    const findRawScriptsByName = vi.fn(async () => [{ _id: "u", name: "fraud-helpers" }]);
    const r = await discoverDeps(client({ findRawScriptsByName }), "alpha", [libRef]);
    expect(r[0]).toEqual({ kind: "script", name: "fraud-helpers", status: "present" });
  });

  it("library ref absent on target → missing", async () => {
    const r = await discoverDeps(client(), "alpha", [libRef]);
    expect(r[0]).toEqual({ kind: "script", name: "fraud-helpers", status: "missing" });
  });

  it("dup-named library → present with an N-on-target note", async () => {
    const findRawScriptsByName = vi.fn(async () => [{ _id: "a" }, { _id: "b" }]);
    const r = await discoverDeps(client({ findRawScriptsByName }), "alpha", [libRef]);
    expect(r[0]).toMatchObject({ status: "present", detail: "2 on target" });
  });

  it("esv ref present as a variable → present, kind in detail", async () => {
    const listVariables = vi.fn(async () => [{ kind: "variable", name: "esv.threshold" }]);
    const r = await discoverDeps(client({ listVariables }), "alpha", [esvRef]);
    expect(r[0]).toEqual({
      kind: "esv",
      name: "esv.threshold",
      status: "present",
      detail: "variable",
    });
  });

  it("esv ref absent → missing; ESV lists fetched once regardless of ref count", async () => {
    const listVariables = vi.fn(async () => []);
    const listSecrets = vi.fn(async () => []);
    const r = await discoverDeps(client({ listVariables, listSecrets }), "alpha", [
      esvRef,
      { kind: "esv", name: "esv.other" },
    ]);
    expect(r.every((x) => x.status === "missing")).toBe(true);
    expect(listVariables).toHaveBeenCalledTimes(1); // index built once, not per-ref
    expect(listSecrets).toHaveBeenCalledTimes(1);
  });
});

describe("missingDepsNote", () => {
  const present: RequiredDepVerdict = { kind: "script", name: "ok-lib", status: "present" };
  const missLib: RequiredDepVerdict = { kind: "script", name: "fraud-helpers", status: "missing" };
  const missEsv: RequiredDepVerdict = { kind: "esv", name: "esv.threshold", status: "missing" };

  it("returns '' when nothing is missing (concatenatable)", () => {
    expect(missingDepsNote([])).toBe("");
    expect(missingDepsNote([present])).toBe("");
  });

  it("warns with the count + names of missing deps", () => {
    const note = missingDepsNote([missLib, present, missEsv]);
    expect(note).toContain("2 referenced dependency");
    expect(note).toContain("fraud-helpers");
    expect(note).toContain("esv.threshold");
    expect(note).toContain("may fail at runtime");
    expect(note).not.toContain("ok-lib"); // present deps aren't named
  });
});
