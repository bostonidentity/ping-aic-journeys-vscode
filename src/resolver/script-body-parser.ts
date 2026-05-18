/**
 * D20 — regex extractors for script-body dependencies.
 *
 * Returns deduped, sorted lists of:
 *   - libraryScripts: every `require('<name>')` / `require("<name>")` argument
 *   - esvs: every `&{esv.<NAME>}` and `systemEnv.<NAME>` reference
 *
 * Accepts > 99% of real AIC scripts. Pathological false-positives (require()
 * inside string literals or comments) are deliberately accepted at M3 — they
 * surface as harmless extra edges. AST upgrade via `acorn` is the documented
 * Plan B if customers hit them in practice.
 */

const REQUIRE = /require\s*\(\s*['"]([^'"\\]+)['"]\s*\)/g;
const ESV_BRACE = /&\{\s*esv\.([A-Za-z0-9_]+)\s*\}/g;
const SYSTEM_ENV = /systemEnv\.([A-Za-z0-9_]+)/g;

export interface ScriptBodyRefs {
  /** Distinct library-script names referenced via `require()`, sorted. */
  libraryScripts: string[];
  /** Distinct ESV names (either `&{esv.X}` or `systemEnv.X` form), sorted. */
  esvs: string[];
}

export function extractScriptBodyRefs(body: string): ScriptBodyRefs {
  const libs = new Set<string>();
  for (const m of body.matchAll(REQUIRE)) libs.add(m[1]);

  const esvs = new Set<string>();
  for (const m of body.matchAll(ESV_BRACE)) esvs.add(m[1]);
  for (const m of body.matchAll(SYSTEM_ENV)) esvs.add(m[1]);

  return {
    libraryScripts: [...libs].sort(),
    esvs: [...esvs].sort(),
  };
}
