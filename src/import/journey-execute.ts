/**
 * Journey-import orchestrator (M9 Phase 4 Batch 3, S6b). Turns a full import
 * plan into ordered writes:
 *   1. all leaves first (reusing `runExecute` — scripts must exist before the
 *      nodes that reference them; leaves are independent of journeys);
 *   2. journeys in dependency order (inner before outer), each via
 *      `writeJourneyUnit` (S6a).
 *
 * Dependency-aware skip (PD-15, cross-journey half): a unit whose prerequisite
 * (a bundled inner journey it references) failed or was skipped is itself
 * skipped with a clear reason — transitively. A failed leaf needs no special
 * handling: its dependent node fails inside `writeJourneyUnit`, failing that
 * unit and (via this skip) its dependents. The batch never aborts.
 *
 * Pure `src/import/` with an injected client (no vscode, no axios).
 */

import { innerTreeRefs } from "./discover";
import { type ExecuteClient, runExecute, type WritePlanItem, type WriteResult } from "./execute";
import { type JourneyWriteClient, type JourneyWriteUnit, writeJourneyUnit } from "./journey-write";

/** Everything the orchestrator writes through — leaves + journey nodes/tree. */
export type JourneyExecuteClient = ExecuteClient & JourneyWriteClient;

export interface JourneyImportPlan {
  /** Leaf write items (scripts/themes/emails/idps/variables/secrets) — written
   * first, via the existing leaf executor. */
  leaves: readonly WritePlanItem[];
  /** Create/Overwrite journey units (Keep units are filtered out upstream). */
  journeys: readonly JourneyWriteUnit[];
  /** `bundleUUID → targetUUID` script remap (S4 `buildScriptRemap`). */
  scriptRemap: ReadonlyMap<string, string>;
}

/** Per-unit dependency edges: `id → bundled inner journeys it references that are
 * ALSO being written` (Keep'd inners already exist on target → not edges). */
function depGraph(units: readonly JourneyWriteUnit[]): Map<string, Set<string>> {
  const writtenIds = new Set(units.map((u) => u.id));
  const graph = new Map<string, Set<string>>();
  for (const u of units) {
    const deps = innerTreeRefs(u.raw).filter((r) => r !== u.id && writtenIds.has(r));
    graph.set(u.id, new Set(deps));
  }
  return graph;
}

/** DFS post-order over the dependency graph → dependencies before dependents
 * (inner before outer). `onPath` breaks any degenerate ref cycle without looping. */
function topoOrder(units: readonly JourneyWriteUnit[]): JourneyWriteUnit[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const graph = depGraph(units);
  const visited = new Set<string>();
  const onPath = new Set<string>();
  const out: JourneyWriteUnit[] = [];
  const visit = (id: string): void => {
    if (visited.has(id) || onPath.has(id)) return;
    onPath.add(id);
    for (const dep of graph.get(id) ?? []) visit(dep);
    onPath.delete(id);
    visited.add(id);
    const u = byId.get(id);
    if (u) out.push(u);
  };
  for (const u of units) visit(u.id);
  return out;
}

async function writeJourneysInOrder(
  client: JourneyExecuteClient,
  realm: string,
  units: readonly JourneyWriteUnit[],
  scriptRemap: ReadonlyMap<string, string>,
  onResult?: (r: WriteResult) => void,
): Promise<WriteResult[]> {
  const graph = depGraph(units);
  // Units that failed OR were skipped — either blocks a dependent.
  const failed = new Set<string>();
  const results: WriteResult[] = [];
  for (const unit of topoOrder(units)) {
    const blockingDep = [...(graph.get(unit.id) ?? [])].find((d) => failed.has(d));
    let r: WriteResult;
    if (blockingDep) {
      r = {
        kind: "journey",
        id: unit.id,
        displayName: unit.displayName,
        status: "skipped",
        message: `prerequisite "${blockingDep}" failed`,
      };
      failed.add(unit.id); // transitive — this unit's own dependents skip too
    } else {
      r = await writeJourneyUnit(client, realm, unit, scriptRemap);
      if (r.status === "failed") failed.add(unit.id);
    }
    onResult?.(r);
    results.push(r);
  }
  return results;
}

/**
 * Run a full journey import: leaves first, then journeys inner-before-outer with
 * dependency-aware skip. Returns one `WriteResult` per leaf and per journey unit,
 * in write order (the UI re-sorts by type for display). Never throws.
 */
export async function runJourneyExecute(
  client: JourneyExecuteClient,
  realm: string,
  plan: JourneyImportPlan,
  /** Invoked after each leaf + journey-unit result (in write order) — drives
   * determinate progress + live row updates (PD-16). */
  onResult?: (r: WriteResult) => void,
): Promise<WriteResult[]> {
  const leafResults = await runExecute(client, realm, plan.leaves, onResult);
  const journeyResults = await writeJourneysInOrder(
    client,
    realm,
    plan.journeys,
    plan.scriptRemap,
    onResult,
  );
  return [...leafResults, ...journeyResults];
}
