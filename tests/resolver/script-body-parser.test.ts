import { describe, expect, it } from "vitest";
import { extractScriptBodyRefs } from "@/resolver/script-body-parser";

describe("extractScriptBodyRefs", () => {
  it("returns empty arrays for an empty body", () => {
    expect(extractScriptBodyRefs("")).toEqual({ libraryScripts: [], esvs: [] });
  });

  it("extracts a single library script from require('helpers')", () => {
    const body = `var h = require('helpers');\nh.go();`;
    expect(extractScriptBodyRefs(body).libraryScripts).toEqual(["helpers"]);
  });

  it("extracts multiple library scripts from single + double quotes, sorted", () => {
    const body = `var a = require("alpha"); var b = require('bravo'); var c = require('charlie');`;
    expect(extractScriptBodyRefs(body).libraryScripts).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("dedupes repeated require() calls for the same name", () => {
    const body = `require("dup"); require("dup"); require('dup');`;
    expect(extractScriptBodyRefs(body).libraryScripts).toEqual(["dup"]);
  });

  it("extracts an ESV reference via the &{esv.X} form", () => {
    const body = `var url = "&{esv.PUBLIC_URL}";`;
    expect(extractScriptBodyRefs(body).esvs).toEqual(["PUBLIC_URL"]);
  });

  it("extracts an ESV reference via systemEnv.X", () => {
    const body = `var t = systemEnv.TENANT_NAME;`;
    expect(extractScriptBodyRefs(body).esvs).toEqual(["TENANT_NAME"]);
  });

  it("dedupes the same ESV across both forms", () => {
    const body = `var a = "&{esv.X}"; var b = systemEnv.X;`;
    expect(extractScriptBodyRefs(body).esvs).toEqual(["X"]);
  });

  it("tolerates whitespace inside require() and &{esv.X}", () => {
    const body = `require(  "padded"  );\nvar v = "&{ esv.WITH_SPACES }";`;
    const refs = extractScriptBodyRefs(body);
    expect(refs.libraryScripts).toEqual(["padded"]);
    expect(refs.esvs).toEqual(["WITH_SPACES"]);
  });

  it("handles a realistic mixed body with multiple of both, deduped + sorted", () => {
    const body = `
      // Auth decision script.
      var helpers = require('helpers');
      var crypto = require("crypto-utils");
      var url = "&{esv.PUBLIC_URL}/oidc/callback";
      var tenantName = systemEnv.TENANT_NAME;
      var fallback = "&{esv.PUBLIC_URL}"; // dup
      helpers.exit(crypto.hash(tenantName));
    `;
    expect(extractScriptBodyRefs(body)).toEqual({
      libraryScripts: ["crypto-utils", "helpers"],
      esvs: ["PUBLIC_URL", "TENANT_NAME"],
    });
  });
});
