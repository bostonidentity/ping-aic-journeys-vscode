import { describe, expect, it } from "vitest";
import { extractScriptBodyRefs } from "@/resolver/script-body-parser";

describe("extractScriptBodyRefs", () => {
  it("returns empty arrays for an empty body", () => {
    expect(extractScriptBodyRefs("")).toEqual({ libraryScripts: [], esvs: [] });
  });

  // ─── require() — unchanged ────────────────────────────────────────────────

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

  // ─── ESV — POC-validated against sb3 ──────────────────────────────────────

  it('extracts an ESV from a systemEnv.getProperty("esv.X.Y.Z") string literal', () => {
    const body = `var t = systemEnv.getProperty("esv.kyid.portal.name");`;
    expect(extractScriptBodyRefs(body).esvs).toEqual(["esv.kyid.portal.name"]);
  });

  it("extracts the ESV from a string literal stored in a constant (indirect getProperty pattern)", () => {
    // Common pattern in sb3: name lives in a const that's later passed via
    // systemEnv.getProperty(nodeConfig.X) or similar. The body still contains
    // the literal "esv.x.y" — our regex catches it.
    const body = `
      var errorMsg_EN = "esv.adaccountlockederrormsg.en";
      errLangMsgJSON["en"] = systemEnv.getProperty(errorMsg_EN);
    `;
    expect(extractScriptBodyRefs(body).esvs).toEqual(["esv.adaccountlockederrormsg.en"]);
  });

  it("extracts multiple ESVs deduped + sorted", () => {
    const body = `
      var a = "esv.alpha.one";
      systemEnv.getProperty("esv.bravo.two");
      var c = 'esv.charlie.three';
      systemEnv.getProperty("esv.alpha.one"); // dup
    `;
    expect(extractScriptBodyRefs(body).esvs).toEqual([
      "esv.alpha.one",
      "esv.bravo.two",
      "esv.charlie.three",
    ]);
  });

  it("requires the 'esv.' prefix — bare identifiers + plain strings are ignored", () => {
    // POC against sb3: 226/226 unique refs start with `esv.`. The prefix is
    // a hard signal — without it, every quoted-dot identifier becomes a
    // false positive.
    const body = `
      var x = systemEnv.getProperty(nodeConfig.errorMsg_EN); // no literal
      var y = "foo.bar.baz";                                 // no prefix
      var z = "esv";                                         // no segments
    `;
    expect(extractScriptBodyRefs(body).esvs).toEqual([]);
  });

  it("does NOT capture systemEnv.<bareIdent> — that was the broken legacy regex", () => {
    // The old `systemEnv\.([A-Za-z0-9_]+)` regex captured `"getProperty"` as
    // an ESV name across 435 sb3 scripts. Make sure we don't regress.
    const body = `systemEnv.getProperty("esv.real.one"); systemEnv.someBogusMethod;`;
    expect(extractScriptBodyRefs(body).esvs).toEqual(["esv.real.one"]);
  });

  it("does NOT capture &{esv.X} — that's an IDM config-string syntax, not used in JS bodies", () => {
    // POC: 0 hits across 1159 sb3 scripts. Intentional drop.
    const body = `var url = "&{esv.PUBLIC_URL}";`;
    expect(extractScriptBodyRefs(body).esvs).toEqual([]);
  });

  it("handles a realistic mixed body — require + multiple ESV refs", () => {
    const body = `
      // Auth decision script
      var helpers = require('helpers');
      var crypto  = require("crypto-utils");
      var portalName = systemEnv.getProperty("esv.kyid.portal.name");
      var fallback   = "esv.kyid.fallback.url";
      var dup        = systemEnv.getProperty("esv.kyid.portal.name"); // dup
      helpers.exit(crypto.hash(portalName));
    `;
    expect(extractScriptBodyRefs(body)).toEqual({
      libraryScripts: ["crypto-utils", "helpers"],
      esvs: ["esv.kyid.fallback.url", "esv.kyid.portal.name"],
    });
  });
});
