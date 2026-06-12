import { describe, expect, it } from "vitest";
import {
  type ExportMeta,
  type LeafExport,
  scriptBodyToExport,
  serializeLeaf,
  serializeScript,
} from "@/export/serialize";
import type { RawScript } from "@/paic/mappers";

const META: ExportMeta = {
  bundleSchemaVersion: "1.0",
  origin: "openam-tenant.example.forgeblocks.com",
  connectionType: "paic",
  realm: "alpha",
  exportedBy: "00000000-0000-0000-0000-000000000000",
  exportDate: "2026-06-11T00:00:00.000Z",
  exportTool: "paic-journeys-vscode",
  exportToolVersion: "0.2.0",
};

const SCRIPT_ID = "00000000-0000-0000-0000-00000000000a";
const BODY_SRC = "// hi\nlogger.message('x');";
const BODY_B64 = Buffer.from(BODY_SRC, "utf8").toString("base64");

type PerTypeKey = "script" | "theme" | "emailTemplate" | "idp" | "variable" | "secret";

/** Pull the sole entity entry out of a single-leaf bundle's per-type map. */
function only(out: LeafExport, key: PerTypeKey): Record<string, unknown> {
  const map = out[key] as Record<string, Record<string, unknown>> | undefined;
  if (!map) throw new Error(`missing ${key} map`);
  const ids = Object.keys(map);
  if (ids.length !== 1) throw new Error(`expected 1 entry, got ${ids.length}`);
  return map[ids[0]];
}

function rawScript(extra: Record<string, unknown> = {}): RawScript {
  return {
    _id: SCRIPT_ID,
    name: "example-script",
    language: "JAVASCRIPT",
    script: BODY_B64,
    context: "AUTHENTICATION_TREE_DECISION_NODE",
    ...extra,
  } as RawScript;
}

describe("serializeScript", () => {
  it("produces a frodo per-type bundle keyed by the script _id", () => {
    const out = serializeScript(rawScript(), META);
    expect(out.meta).toEqual(META);
    expect(Object.keys(out.script ?? {})).toEqual([SCRIPT_ID]);
    const entry = only(out, "script");
    expect(entry._id).toBe(SCRIPT_ID);
    expect(entry.name).toBe("example-script");
    expect(entry.context).toBe("AUTHENTICATION_TREE_DECISION_NODE");
  });

  it("strips server-managed diff-mask fields but keeps _id", () => {
    const entry = only(
      serializeScript(
        rawScript({
          _rev: "42",
          createdBy: "id=x,ou=user,ou=am-config",
          creationDate: 123,
          lastModifiedBy: "id=y,ou=user,ou=am-config",
          lastModifiedDate: 456,
          evaluatorVersion: "1.0",
        }),
        META,
      ),
      "script",
    );
    expect(entry._id).toBe(SCRIPT_ID);
    for (const masked of [
      "_rev",
      "createdBy",
      "creationDate",
      "lastModifiedBy",
      "lastModifiedDate",
      "evaluatorVersion",
    ]) {
      expect(entry).not.toHaveProperty(masked);
    }
  });

  it("converts the base64 body to the stringified-decoded form", () => {
    expect(only(serializeScript(rawScript(), META), "script").script).toBe(
      JSON.stringify(BODY_SRC),
    );
  });
});

describe("scriptBodyToExport", () => {
  it("decodes base64 then JSON-stringifies the source", () => {
    expect(scriptBodyToExport(BODY_B64)).toBe(JSON.stringify(BODY_SRC));
  });
});

describe("serializeLeaf", () => {
  it("emits the frodo per-type key for each kind, keyed by wire _id", () => {
    expect(Object.keys(serializeLeaf("theme", { _id: "t-1" }, META, "fb").theme ?? {})).toEqual([
      "t-1",
    ]);
    expect(
      Object.keys(serializeLeaf("socialIdp", { _id: "google" }, META, "fb").idp ?? {}),
    ).toEqual(["google"]);
    expect(
      Object.keys(serializeLeaf("variable", { _id: "esv-a-b" }, META, "fb").variable ?? {}),
    ).toEqual(["esv-a-b"]);
    expect(
      Object.keys(serializeLeaf("secret", { _id: "esv-c-d" }, META, "fb").secret ?? {}),
    ).toEqual(["esv-c-d"]);
    expect(
      Object.keys(
        serializeLeaf("emailTemplate", { _id: "emailTemplate/welcome" }, META, "fb")
          .emailTemplate ?? {},
      ),
    ).toEqual(["emailTemplate/welcome"]);
  });

  it("strips mask fields but keeps _type (needed for social-IdP import)", () => {
    const out = serializeLeaf(
      "socialIdp",
      { _id: "google", _type: { _id: "oidcConfig" }, _rev: "3", clientSecret: "redacted" },
      META,
      "fb",
    );
    const entry = only(out, "idp");
    expect(entry._type).toEqual({ _id: "oidcConfig" });
    expect(entry.clientSecret).toBe("redacted");
    expect(entry).not.toHaveProperty("_rev");
  });

  it("does NOT transform a `script` field for non-script kinds", () => {
    const out = serializeLeaf("theme", { _id: "t", script: BODY_B64 }, META, "fb");
    expect(only(out, "theme").script).toBe(BODY_B64);
  });

  it("falls back to fallbackId when the raw object has no _id", () => {
    const out = serializeLeaf("variable", { description: "x" }, META, "esv.a.b");
    expect(Object.keys(out.variable ?? {})).toEqual(["esv.a.b"]);
  });
});
