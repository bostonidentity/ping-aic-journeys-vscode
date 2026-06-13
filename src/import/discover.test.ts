import { describe, expect, it } from "vitest";
import { discoverScriptDeps } from "./discover";
import type { ImportComponent } from "./parse";

/** Bundle body form: JSON-stringified decoded source (serialize.ts). */
const body = (src: string): string => JSON.stringify(src);

const scriptComp = (id: string, src: string): ImportComponent => ({
  kind: "script",
  id,
  displayName: id,
  raw: { _id: id, name: id, script: body(src) },
});

describe("discoverScriptDeps", () => {
  it("extracts deduped, sorted lib + esv refs from a script body", () => {
    const refs = discoverScriptDeps([
      scriptComp(
        "s1",
        "var h = require('fraud-helpers');\nvar t = 'esv.risk.threshold';\nrequire('http-util');",
      ),
    ]);
    expect(refs).toEqual([
      { kind: "script", name: "fraud-helpers" },
      { kind: "script", name: "http-util" },
      { kind: "esv", name: "esv.risk.threshold" },
    ]);
  });

  it("dedupes refs across multiple script components in a bundle", () => {
    const refs = discoverScriptDeps([
      scriptComp("s1", "require('shared');\n'esv.a';"),
      scriptComp("s2", "require('shared');\n'esv.b';"),
    ]);
    expect(refs.filter((r) => r.kind === "script")).toEqual([{ kind: "script", name: "shared" }]);
    expect(refs.filter((r) => r.kind === "esv").map((r) => r.name)).toEqual(["esv.a", "esv.b"]);
  });

  it("ignores comment-only references (inherits extractScriptBodyRefs stripping)", () => {
    const refs = discoverScriptDeps([scriptComp("s1", "// require('dead');\nrequire('live');")]);
    expect(refs).toEqual([{ kind: "script", name: "live" }]);
  });

  it("ignores non-script components", () => {
    const comps: ImportComponent[] = [
      { kind: "variable", id: "esv-x", displayName: "x", raw: { _id: "esv-x" } },
      { kind: "theme", id: "t", displayName: "t", raw: { _id: "t" } },
    ];
    expect(discoverScriptDeps(comps)).toEqual([]);
  });

  it("yields nothing for a script with no deps, or a malformed body", () => {
    expect(discoverScriptDeps([scriptComp("s1", "logger.message('hi');")])).toEqual([]);
    expect(
      discoverScriptDeps([{ kind: "script", id: "s", displayName: "s", raw: { script: 42 } }]),
    ).toEqual([]);
  });
});
