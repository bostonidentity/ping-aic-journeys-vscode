/**
 * Import compatibility gate (D42 / TD-6, M9 Phase 4 Batch 1). Pure. Can a
 * component of a given `BundleKind` be written to a target of a given
 * deployment kind? On-prem is bare AM — only the AM-native leaves exist
 * (scripts, social IdPs); the IDM/platform leaves (theme, email template, ESV
 * variable/secret) have no endpoint there. PAIC supports all.
 *
 * B2's pre-flight reuses `compatFor` to gate its compare fetch (don't fetch a
 * target version for a component the target can't accept).
 */

import type { BundleKind } from "./parse";

export type CompatVerdict = "ok" | "unsupported";

/** Leaf kinds an on-prem AM target can accept (AM-native). */
const ONPREM_SUPPORTED: ReadonlySet<BundleKind> = new Set<BundleKind>(["script", "socialIdp"]);

export function compatFor(kind: BundleKind, targetKind: "paic" | "onprem"): CompatVerdict {
  if (targetKind === "paic") return "ok";
  return ONPREM_SUPPORTED.has(kind) ? "ok" : "unsupported";
}
