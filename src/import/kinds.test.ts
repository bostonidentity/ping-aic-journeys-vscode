import { describe, expect, it } from "vitest";
import { classifyCompare } from "./compare";
import { compatFor } from "./compat";
import { WRITABLE_KINDS } from "./kinds";
import type { BundleKind } from "./parse";

describe("kind-capability coherence", () => {
  it("every writable kind is supported on a paic target", () => {
    for (const k of WRITABLE_KINDS) {
      expect(compatFor(k, "paic")).toBe("ok");
    }
  });

  it("existence-only kinds (script / variable / secret) never value-compare", () => {
    for (const k of ["script", "variable", "secret"] as BundleKind[]) {
      // Differing content still classifies as `exists`, never `differs` — so an
      // existence-only kind is never written as an "overwrite".
      expect(classifyCompare(k, { a: 1 }, { a: 2 })).toBe("exists");
    }
  });
});
