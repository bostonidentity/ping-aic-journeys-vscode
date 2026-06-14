/**
 * Freeze-the-plan + drift check (M9 Phase 4 Batch 3, S7 / PD-11). Closes the
 * preview→commit TOCTOU: the user reviews a plan, then clicks Import minutes
 * later — but the target may have changed underneath. We freeze the resolved
 * plan + a snapshot of the target state at preview, then re-verify at commit;
 * if the target drifted, the caller stops and forces a re-plan rather than
 * applying a stale plan.
 *
 * Snapshot granularity is the **verdict** — exactly what the table shows ("keep
 * it inspectable — it IS our webview table"). A verdict change is the
 * categorical drift that matters: `new→exists` (a create would silently
 * clobber), `exists→new` (a Keep'd inner / overwrite target was deleted),
 * `identical↔differs` (content changed across the compare boundary), a blocking
 * gate `present↔missing` (node type / must-exist inner appeared or vanished).
 * Reuses the whole preflight stack (`runPreflight` + `checkJourneyGates`).
 *
 * Pure `src/import/` + an injected read-only `PreflightClient` (no vscode).
 */

import type { ComponentVerdict } from "./compare";
import type { JourneyImportPlan } from "./journey-execute";
import type { ImportComponent } from "./parse";
import {
  checkJourneyGates,
  type PreflightClient,
  type RequiredDepVerdict,
  runPreflight,
} from "./preflight";

/** The immutable saved-plan (PD-11): the frozen decisions + the target snapshot
 * captured at preview. `runJourneyExecute` runs `plan` exactly; `detectDrift`
 * re-reads against `snapshot` before commit. Treat as immutable after creation. */
export interface FrozenPlan {
  readonly realm: string;
  readonly targetKind: "paic" | "onprem";
  /** The bundle's components — re-run through the preflight at commit. */
  readonly rawComponents: readonly ImportComponent[];
  /** The frozen write plan (decisions + remap) — executed verbatim. */
  readonly plan: JourneyImportPlan;
  /** Target state at preview: `key → status` (see `snapshotState`). */
  readonly snapshot: ReadonlyMap<string, string>;
}

/** One drifted snapshot entry — `was` (preview) vs `now` (commit); the absent
 * side reads `"(absent)"`. */
export interface DriftItem {
  key: string;
  was: string;
  now: string;
}

/** The drift verdict — `drifted` empty ⇒ the target is unchanged ⇒ safe to apply. */
export interface DriftReport {
  drifted: DriftItem[];
}

const ABSENT = "(absent)";

/**
 * Build the comparable target snapshot from a preflight pass. Each component
 * verdict keys `${kind}:${id} → status` (leaves + journeys); each **blocking**
 * gate keys `${kind}:${name} → status`. Advisory gates (lib/ESV refs) are
 * excluded — they never gated import, so they're out of drift too. Used at both
 * freeze (preview) and inside `detectDrift` (commit) for identical keying.
 */
export function snapshotState(
  componentVerdicts: readonly ComponentVerdict[],
  gates: readonly RequiredDepVerdict[],
): Map<string, string> {
  const snap = new Map<string, string>();
  for (const v of componentVerdicts) snap.set(`${v.kind}:${v.id}`, v.status);
  for (const g of gates) {
    if (g.severity === "blocking") snap.set(`${g.kind}:${g.name}`, g.status);
  }
  return snap;
}

/** Diff two snapshots — a `DriftItem` for every key whose status differs (or
 * exists on only one side). Pure; order follows `was` then `now`-only keys. */
export function diffSnapshots(
  was: ReadonlyMap<string, string>,
  now: ReadonlyMap<string, string>,
): DriftItem[] {
  const drifted: DriftItem[] = [];
  const keys = new Set<string>([...was.keys(), ...now.keys()]);
  for (const key of keys) {
    const a = was.get(key) ?? ABSENT;
    const b = now.get(key) ?? ABSENT;
    if (a !== b) drifted.push({ key, was: a, now: b });
  }
  return drifted;
}

/**
 * Re-read the target and compare to the frozen snapshot (PD-11). Re-runs the
 * preflight + journey gates, rebuilds the snapshot, and diffs it against
 * `frozen.snapshot`. A non-empty `drifted` means the caller must force a re-plan
 * instead of applying. Read-only.
 */
export async function detectDrift(
  client: PreflightClient,
  frozen: FrozenPlan,
): Promise<DriftReport> {
  const [verdicts, gates] = await Promise.all([
    runPreflight(client, frozen.realm, frozen.targetKind, frozen.rawComponents),
    checkJourneyGates(client, frozen.realm, frozen.rawComponents),
  ]);
  const now = snapshotState(verdicts, gates);
  return { drifted: diffSnapshots(frozen.snapshot, now) };
}
