import { describe, expect, it } from "vitest";
import { parseBundle } from "./parse";

const META = {
  bundleSchemaVersion: "1.0",
  origin: "openam-tenant.example.forgeblocks.com",
  connectionType: "paic",
  realm: "alpha",
  exportDate: "2026-06-11T00:00:00.000Z",
  exportTool: "paic-journeys-vscode",
  exportToolVersion: "0.1.1",
};

/** Build a bundle JSON string from an object. */
const j = (o: unknown): string => JSON.stringify(o);

describe("parseBundle — leaf bundles", () => {
  it("recognizes a theme bundle and uses the object name as display name", () => {
    const r = parseBundle(
      j({
        meta: META,
        theme: { zzzexporttesttheme: { _id: "zzzexporttesttheme", name: "zzz theme" } },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bundle.kind).toBe("theme");
    expect(r.bundle.label).toBe("Theme");
    expect(r.bundle.components).toEqual([
      { kind: "theme", id: "zzzexporttesttheme", displayName: "zzz theme" },
    ]);
    expect(r.bundle.meta?.realm).toBe("alpha");
  });

  it("strips the emailTemplate/ prefix from the display name", () => {
    const r = parseBundle(
      j({ meta: META, emailTemplate: { "emailTemplate/zzzTpl": { _id: "emailTemplate/zzzTpl" } } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bundle.kind).toBe("emailTemplate");
    expect(r.bundle.components[0]).toEqual({
      kind: "emailTemplate",
      id: "emailTemplate/zzzTpl",
      displayName: "zzzTpl",
    });
  });

  it("maps the `idp` key to socialIdp and surfaces the provider type", () => {
    const r = parseBundle(
      j({ meta: META, idp: { zzz_idp: { _id: "zzz_idp", _type: { _id: "oidcConfig" } } } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bundle.kind).toBe("socialIdp");
    expect(r.bundle.label).toBe("Social IdP");
    expect(r.bundle.components[0].detail).toBe("oidcConfig");
  });

  it("labels a library script via its context", () => {
    const r = parseBundle(
      j({ meta: META, script: { id1: { _id: "id1", name: "lib", context: "LIBRARY" } } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bundle.kind).toBe("script");
    expect(r.bundle.components[0]).toEqual({
      kind: "script",
      id: "id1",
      displayName: "lib",
      detail: "library script",
    });
  });

  it("recognizes ESV variable and secret bundles", () => {
    const v = parseBundle(j({ meta: META, variable: { "esv-x": { _id: "esv-x" } } }));
    const s = parseBundle(j({ meta: META, secret: { "esv-y": { _id: "esv-y" } } }));
    expect(v.ok && v.bundle.kind).toBe("variable");
    expect(s.ok && s.bundle.kind).toBe("secret");
  });

  it("tolerates a missing meta block", () => {
    const r = parseBundle(j({ theme: { t: { _id: "t", name: "T" } } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bundle.meta).toBeNull();
    expect(r.bundle.kind).toBe("theme");
  });
});

describe("parseBundle — journey bundles", () => {
  const tree = (over: Record<string, unknown> = {}) => ({
    tree: { _id: "t" },
    nodes: { n1: {}, n2: {} },
    innerNodes: { i1: {} },
    scripts: { s1: { context: "AUTHENTICATION_TREE_DECISION_NODE" }, s2: { context: "LIBRARY" } },
    themes: { th: {} },
    emailTemplates: {},
    socialIdentityProviders: { idp: {} },
    ...over,
  });

  it("summarizes a level-1 journey: one tree + requires.innerJourneys", () => {
    const r = parseBundle(
      j({
        meta: {
          ...META,
          depthMode: "level1",
          requires: { innerJourneys: ["inner_j"], esvs: ["esv.x"], nodeTypes: [] },
        },
        trees: { main_j: tree() },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bundle.kind).toBe("journey");
    expect(r.bundle.label).toBe("Journey bundle (1 tree)");
    expect(r.bundle.components).toEqual([{ kind: "journey", id: "main_j", displayName: "main_j" }]);
    expect(r.bundle.inventory).toContain("Depth: level1");
    expect(r.bundle.inventory).toContain("Scripts: 2 (1 library)");
    expect(r.bundle.inventory).toContain("Requires — inner journeys: inner_j");
    expect(r.bundle.inventory).toContain("Requires — ESVs: esv.x");
  });

  it("summarizes an all-levels journey: multiple trees + innerTreesIncluded", () => {
    const r = parseBundle(
      j({
        meta: {
          ...META,
          depthMode: "allLevels",
          innerTreesIncluded: ["inner_j"],
          requires: { innerJourneys: [], esvs: [], nodeTypes: [] },
        },
        trees: { main_j: tree(), inner_j: tree({ socialIdentityProviders: {} }) },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bundle.label).toBe("Journey bundle (2 trees)");
    expect(r.bundle.components.map((c) => c.id)).toEqual(["main_j", "inner_j"]);
    expect(r.bundle.inventory).toContain("Inner trees included: inner_j");
    // aggregate counts across both trees (4 scripts, 2 library)
    expect(r.bundle.inventory).toContain("Scripts: 4 (2 library)");
  });
});

describe("parseBundle — errors", () => {
  it("rejects invalid JSON", () => {
    const r = parseBundle("{ not json");
    expect(r).toEqual({ ok: false, error: expect.stringContaining("valid JSON") });
  });

  it("rejects an unrecognized shape", () => {
    const r = parseBundle(j({ meta: META, somethingElse: { x: {} } }));
    expect(r.ok).toBe(false);
  });

  it("rejects a bundle mixing multiple component types", () => {
    const r = parseBundle(j({ theme: { t: {} }, script: { s: {} } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("multiple component types");
  });
});

describe("parseBundle — rawComponents (extension-side compare payload)", () => {
  it("carries the raw leaf object + identity for each component", () => {
    const raw = { _id: "tid", name: "T", backgroundColor: "#1" };
    const r = parseBundle(j({ meta: META, theme: { tid: raw } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rawComponents).toEqual([{ kind: "theme", id: "tid", displayName: "T", raw }]);
  });

  it("extracts every entry of a multi-component leaf bundle", () => {
    const r = parseBundle(j({ script: { a: { name: "a" }, b: { name: "b" } } }));
    expect(r.ok && r.rawComponents.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("is empty for a journey bundle", () => {
    const r = parseBundle(j({ trees: { a: { nodes: {} } } }));
    expect(r.ok && r.rawComponents).toEqual([]);
  });
});

describe("parseBundle — ESV preview", () => {
  it("decodes the variable value for the preview", () => {
    // "ZXhwb3J0LXRlc3Q=" === base64("export-test")
    const r = parseBundle(
      j({ meta: META, variable: { "esv-x": { _id: "esv-x", valueBase64: "ZXhwb3J0LXRlc3Q=" } } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bundle.components[0].detail).toBe("value: export-test");
  });

  it("marks a secret as supplied-at-import (no value in the bundle)", () => {
    const r = parseBundle(j({ meta: META, secret: { "esv-s": { _id: "esv-s" } } }));
    expect(r.ok && r.bundle.components[0].detail).toBe("value supplied at import");
  });
});
