/**
 * Journey-import plan assembly (M9 Phase 4 Batch 3, S8a). Turns the preview's
 * preflight outputs + the user's decisions into the `JourneyImportPlan` that
 * `runJourneyExecute` consumes, plus the blocking-prerequisite list and the
 * count summary the confirm modal shows.
 *
 * Pure `src/import/` (no vscode, no network) — the panel collects the inputs
 * (verdicts/gates/plans from preflight, the user's leaf selection + per-journey
 * actions) and does the vscode glue (confirm / secrets / progress) around this.
 */

import type { CompareVerdict, ComponentVerdict } from "./compare";
import type { WritePlanItem } from "./execute";
import type { JourneyImportPlan } from "./journey-execute";
import type { JourneyAction, JourneyUnitPlan } from "./journey-plan";
import type { JourneyWriteUnit } from "./journey-write";
import { WRITABLE_KINDS } from "./kinds";
import type { ImportComponent } from "./parse";
import type { RequiredDepVerdict } from "./preflight";
import { buildScriptRemap } from "./remap";

export interface AssembleInput {
  rawComponents: readonly ImportComponent[];
  /** Component verdicts from `runPreflight` (leaves + journeys). */
  verdicts: readonly ComponentVerdict[];
  /** Blocking journey gates from `checkJourneyGates`. */
  gates: readonly RequiredDepVerdict[];
  /** Per-unit Create/Overwrite/Keep decisions from `planJourneyUnits`. */
  journeyPlans: readonly JourneyUnitPlan[];
  /** User's per-journey action overrides (`id → action`); absent ⇒ `defaultAction`. */
  journeyActions?: Readonly<Record<string, JourneyAction>>;
  /** Selected leaf row keys (`${kind}:${id}`); a leaf not present is excluded. */
  selectedLeafKeys: ReadonlySet<string>;
}

export interface AssembledImport {
  plan: JourneyImportPlan;
  /** Blocking prerequisites still missing (`${kind}:${name}`) — non-empty ⇒ the
   * import must not proceed (the UI disables Import; the panel double-checks). */
  blockingMissing: string[];
  counts: { create: number; overwrite: number; keep: number };
}

/** The verdict statuses that produce a leaf write (a New create / a Differs overwrite). */
const isWritableLeafStatus = (
  s: ComponentVerdict["status"],
): s is Extract<CompareVerdict, "new" | "differs"> => s === "new" || s === "differs";

/** Resolve a unit's action: the user's override when allowed, else the default. */
function resolveAction(plan: JourneyUnitPlan, override: JourneyAction | undefined): JourneyAction {
  if (override && plan.allowedActions.includes(override)) return override;
  return plan.defaultAction;
}

/**
 * Assemble the `JourneyImportPlan` (selected leaves + non-Keep journey units +
 * script remap), the blocking-missing list, and the action counts.
 */
export function assembleJourneyImport(input: AssembleInput): AssembledImport {
  const rawByKey = new Map(input.rawComponents.map((c) => [`${c.kind}:${c.id}`, c]));

  // Leaves — selected, writable-kind, New/Differs, non-journey.
  const leaves: WritePlanItem[] = [];
  let leafCreate = 0;
  let leafOverwrite = 0;
  for (const v of input.verdicts) {
    if (v.kind === "journey") continue;
    if (!isWritableLeafStatus(v.status)) continue;
    if (!WRITABLE_KINDS.has(v.kind)) continue;
    if (!input.selectedLeafKeys.has(`${v.kind}:${v.id}`)) continue;
    const component = rawByKey.get(`${v.kind}:${v.id}`);
    if (!component) continue;
    leaves.push({
      component,
      verdict: v.status,
      ...(v.resolvedTargetId ? { resolvedTargetId: v.resolvedTargetId } : {}),
    });
    if (v.status === "new") leafCreate += 1;
    else leafOverwrite += 1;
  }

  // Journey units — resolve each action; Keep drops out, Create/Overwrite are written.
  const journeys: JourneyWriteUnit[] = [];
  let jCreate = 0;
  let jOverwrite = 0;
  let jKeep = 0;
  for (const plan of input.journeyPlans) {
    const action = resolveAction(plan, input.journeyActions?.[plan.id]);
    if (action === "keep") {
      jKeep += 1;
      continue;
    }
    if (action === "create") jCreate += 1;
    else jOverwrite += 1;
    const component = rawByKey.get(`journey:${plan.id}`);
    if (!component) continue;
    journeys.push({ id: plan.id, displayName: plan.displayName, raw: component.raw });
  }

  const scriptRemap = buildScriptRemap(input.verdicts.filter((v) => v.kind === "script"));

  const blockingMissing = input.gates
    .filter((g) => g.severity === "blocking" && g.status === "missing")
    .map((g) => `${g.kind}:${g.name}`);

  return {
    plan: { leaves, journeys, scriptRemap },
    blockingMissing,
    counts: {
      create: leafCreate + jCreate,
      overwrite: leafOverwrite + jOverwrite,
      keep: jKeep,
    },
  };
}
