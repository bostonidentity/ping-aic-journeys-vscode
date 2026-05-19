/**
 * D20 — regex extractors for script-body dependencies.
 *
 * Returns deduped, sorted lists of:
 *   - libraryScripts: every `require('<name>')` / `require("<name>")` argument
 *   - esvs: every `'<esv.x.y.z>'` / `"<esv.x.y.z>"` string literal
 *
 * ESV-pattern rationale (POC-validated against 1159 sb3 scripts):
 *
 *   - `systemEnv.getProperty("esv.x.y")` is the dominant form (383 scripts,
 *     779 refs). The string literal IS the ESV name, dotted.
 *   - But many scripts use indirect refs: `var foo = "esv.x.y"; … getProperty(foo)`.
 *     A regex tied to `systemEnv.getProperty(…)` would miss these.
 *   - The broader pattern `['"](esv\.X)['"]` catches both: 442 scripts, 915
 *     refs across the same tenant — strict superset.
 *   - The legacy `&{esv.X}` syntax (used inside IDM config strings) had 0
 *     hits in 1159 production JS bodies; intentionally dropped.
 *   - All 226 unique ESV refs across sb3 begin with `esv.` — safe to require.
 *
 * Pathological false-positives (the literal `"esv.x.y"` appearing in a
 * comment or doc-string) surface as harmless extra edges. AST upgrade via
 * `acorn` is the documented Plan B if a customer hits one in practice.
 *
 * NOTE — referenced names are in **dotted form** (`esv.kyid.portal.name`)
 * because that's how scripts reference them. The PAIC ESV REST API
 * requires hyphenated ids (`esv-kyid-portal-name`); translation happens
 * inside `PaicClient.getEsv()`, not here.
 */

const REQUIRE = /require\s*\(\s*['"]([^'"\\]+)['"]\s*\)/g;
const ESV = /['"](esv\.[A-Za-z0-9_.-]+?)['"]/g;

export interface ScriptBodyRefs {
  /** Distinct library-script names referenced via `require()`, sorted. */
  libraryScripts: string[];
  /** Distinct ESV names (dotted, e.g. `esv.foo.bar`), sorted. */
  esvs: string[];
}

/** Strip JS line + block comments before regex scanning. Eliminates the
 * largest false-positive class for ESV detection (commented-out
 * alternatives like `// var x = "esv.dead.code";`).
 *
 * URL preservation: only matches `//` not preceded by `:` so that
 * `http://example.com` stays intact (the regex captures the character
 * before `//` and re-emits it via `$1`).
 *
 * Known limitation: this is regex-only, not AST-aware. A `//` or `/*`
 * appearing inside a string literal is treated as a comment start and the
 * rest of the line/block is stripped. Acceptable for our purposes — the
 * ESV regex only matches `'esv.X'` literals, which don't contain `//`
 * or `/*` sequences. */
function stripComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function extractScriptBodyRefs(body: string): ScriptBodyRefs {
  const stripped = stripComments(body);

  const libs = new Set<string>();
  for (const m of stripped.matchAll(REQUIRE)) libs.add(m[1]);

  const esvs = new Set<string>();
  for (const m of stripped.matchAll(ESV)) esvs.add(m[1]);

  return {
    libraryScripts: [...libs].sort(),
    esvs: [...esvs].sort(),
  };
}
