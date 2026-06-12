/**
 * Import compare engine (D42 / TD-6, M9 Phase 4 Batch 1 Slice B2). Pure.
 * Classifies a bundle component against the target's current version:
 *   - atoms (theme / emailTemplate / socialIdp) → value-compare (identical / differs)
 *   - script / variable / secret → existence-only (new / exists). A secret's
 *     value is never on the wire (permanent); script body-encoding + variable
 *     value-compare land with their write batch (Batch 2).
 * Both sides are normalized identically before equality — otherwise
 * `_rev`/timestamps/identity fields would make everything "differs".
 */

import { stripMask } from "../export/serialize";
import type { BundleKind } from "./parse";

export type CompareVerdict = "new" | "identical" | "differs" | "exists";

/** Per-component pre-flight status — `classifyCompare`'s output plus the
 * panel-set `unsupported` (compat gate) and `error` (the fetch threw). */
export type ComponentStatus = CompareVerdict | "unsupported" | "error";

export interface ComponentVerdict {
  kind: BundleKind;
  id: string;
  displayName: string;
  status: ComponentStatus;
  message?: string;
}

/** Kinds whose CONTENT we value-compare (the Batch-1 atoms). Everything else
 * is existence-only this slice. */
const VALUE_COMPARED: ReadonlySet<BundleKind> = new Set<BundleKind>([
  "theme",
  "emailTemplate",
  "socialIdp",
]);

export function classifyCompare(
  kind: BundleKind,
  bundleRaw: Record<string, unknown>,
  targetRaw: Record<string, unknown> | null,
): CompareVerdict {
  if (targetRaw === null) return "new";
  if (!VALUE_COMPARED.has(kind)) return "exists";
  return stableStringify(normalizeForCompare(kind, bundleRaw)) ===
    stableStringify(normalizeForCompare(kind, targetRaw))
    ? "identical"
    : "differs";
}

/** Strip identity + server-managed + env-drift fields so two equivalent
 * entities compare equal regardless of where/when they were read. Operates on
 * a fresh object (`stripMask` clones) — never mutates the input. */
export function normalizeForCompare(
  kind: BundleKind,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out = stripMask(raw); // drops _rev + audit fields, keeps _id
  delete out._id; // identity, not content — we already matched by it on fetch
  if (kind === "theme") {
    delete out.linkedTrees; // reverse-ref (which journeys link here), not pushable
    delete out.isDefault; // per-realm UI state, not theme content
  }
  if (kind === "socialIdp") {
    delete out.clientSecret; // redacted on read → never equal across envs
    delete out._type; // server-added provider-type object (identity)
  }
  return out;
}

/** Canonical JSON with recursively sorted keys. Both compared objects come
 * from `JSON.parse` (no `undefined`), so sorted-canonical + `===` is the
 * simplest correct deep equality — no library needed. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
