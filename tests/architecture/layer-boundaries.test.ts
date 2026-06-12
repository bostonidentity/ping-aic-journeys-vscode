/**
 * D21 — enforce the three-independent-cache layer boundaries at the import
 * level. The boundary rules are documented in `docs/design-plan.md` D21
 * and in `.claude/rules/conventions.md` (Import conventions); this test is
 * the load-bearing enforcement that catches drift.
 *
 * Rule shape: each top-level source directory may NOT import from a fixed
 * set of forbidden sibling directories. The regex catches both `@/`
 * path-aliased imports and any depth of relative imports (`./`, `../`,
 * `../../`, …). On a directory that does not yet exist (e.g.
 * `src/realm-index/` until M5 lands), `walk()` returns an empty list and
 * the assertion trivially passes.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    })
    .filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"));
}

describe("D21 layer boundaries", () => {
  // Note: `src/webview/*` deliberately is NOT a single broad rule. Extension-
  // side panel.ts files in this tree are the wiring shim and DO import the
  // resolver cache (D35 wires resolveFull through them). The runtime sandbox
  // — every React file under `ui/**` — is what must stay cache-free. We
  // scope the rule to the `ui/` subtrees specifically.
  const cases: Array<{ from: string; forbidden: RegExp }> = [
    {
      from: "src/realm-index",
      forbidden: /from\s+["'](?:@\/|(?:\.\.?\/)+)(?:views|resolver|webview|tenants)\b/,
    },
    {
      from: "src/resolver",
      forbidden: /from\s+["'](?:@\/|(?:\.\.?\/)+)(?:views|realm-index|webview|tenants)\b/,
    },
    { from: "src/views", forbidden: /from\s+["'](?:@\/|(?:\.\.?\/)+)(?:realm-index|resolver)\b/ },
    {
      from: "src/webview/inspector/ui",
      forbidden: /from\s+["'](?:@\/|(?:\.\.?\/)+)(?:realm-index|resolver|tenants|paic)\b/,
    },
    {
      from: "src/webview/connection-form/ui",
      forbidden: /from\s+["'](?:@\/|(?:\.\.?\/)+)(?:realm-index|resolver|tenants|paic)\b/,
    },
    {
      from: "src/webview/transfer/ui",
      forbidden: /from\s+["'](?:@\/|(?:\.\.?\/)+)(?:realm-index|resolver|tenants|paic)\b/,
    },
  ];

  for (const { from, forbidden } of cases) {
    it(`${from} respects D21 import boundary`, () => {
      const violations = walk(from).filter((p) => forbidden.test(readFileSync(p, "utf8")));
      expect(violations).toEqual([]);
    });
  }
});
