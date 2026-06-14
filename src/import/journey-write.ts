/**
 * Journey-unit writer (M9 Phase 4 Batch 3, S6a). Writes ONE journey unit — its
 * nodes (page-children + top-level) then its tree — as **update-in-place PUTs**
 * (PD-13: never delete-then-recreate; a journey is a live auth tree). Pure
 * `src/import/` with an injected client (no vscode, no axios).
 *
 * Hardening:
 *   - PD-12 — each node's `script` ref is remapped (S4 `remapNodeScript`) then
 *     asserted (S4 `assertScriptRefsResolved`) before its PUT; a surviving source
 *     UUID throws rather than writing a dangling reference.
 *   - PD-15 (local) — if ANY node fails, the tree is NOT written (never a
 *     half-wired tree) and the unit is `failed`. The cross-journey half (a failed
 *     unit skips its dependents) is the S6b orchestrator's job.
 *   - G2 — every PUT carries frodo's `400 "Invalid attribute specified."`
 *     strip-and-retry safety net (`JourneyOps.ts`): drop the attributes AM didn't
 *     list as valid (keeping `_id`) and retry once. TD-15 proved routine writes
 *     need no strip pass, so this only fires on edge cases.
 *
 * The nodes/tree are written raw-as-is (TD-15 — AM tolerates the `_type`/
 * `_outcomes` echoes; `_rev`/audit fields were stripped at export). The only
 * mutation is the script remap.
 */

import type { PaicClient } from "../paic/client";
import type { WriteResult } from "./execute";
import { assertScriptRefsResolved, remapNodeScript } from "./remap";
import { putWithRetry } from "./write-retry";

/** The subset of `PaicClient` the journey writer uses. */
export type JourneyWriteClient = Pick<PaicClient, "writeNode" | "writeTree">;

/** A Create/Overwrite journey unit to write — `raw` is the decomposed
 * `{ tree, nodes, innerNodes }` from `parse.ts` (S2). Structural input (no
 * `ImportComponent` / `JourneyUnitPlan` coupling); Keep units are filtered out
 * upstream (S6b), so the writer only sees units it should write. */
export interface JourneyWriteUnit {
  id: string;
  displayName: string;
  raw: Record<string, unknown>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * Write one journey unit: every node (page-children first, then top-level) with
 * the script remap + PD-12 assertion + G2 retry, then — only if all nodes
 * succeeded — the tree. Returns a single per-unit `WriteResult` (`kind:
 * "journey"`): the tree's create/overwrite outcome, or `failed` (the message
 * names the offending node or carries the tree error). Never throws.
 */
export async function writeJourneyUnit(
  client: JourneyWriteClient,
  realm: string,
  unit: JourneyWriteUnit,
  scriptRemap: ReadonlyMap<string, string>,
): Promise<WriteResult> {
  const base = { kind: "journey" as const, id: unit.id, displayName: unit.displayName };
  const nodes = isRecord(unit.raw.nodes) ? unit.raw.nodes : {};
  const innerNodes = isRecord(unit.raw.innerNodes) ? unit.raw.innerNodes : {};
  // Page-children before their containers (order-agnostic per TD-15, safe choice).
  const entries = [...Object.entries(innerNodes), ...Object.entries(nodes)];

  for (const [nodeId, raw] of entries) {
    const node = isRecord(raw) ? raw : {};
    const nodeType = isRecord(node._type) ? str(node._type._id) : undefined;
    if (!nodeType) {
      return { ...base, status: "failed", message: `node "${nodeId}" missing _type._id` };
    }
    try {
      const remapped = remapNodeScript(node, scriptRemap);
      assertScriptRefsResolved(remapped, scriptRemap); // PD-12
      await putWithRetry((b) => client.writeNode(realm, nodeType, nodeId, b), remapped);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ...base,
        status: "failed",
        message: `node "${nodeId}" (${nodeType}) failed: ${msg}; tree not written`,
      };
    }
  }

  const tree = isRecord(unit.raw.tree) ? unit.raw.tree : {};
  try {
    const outcome = await putWithRetry((b) => client.writeTree(realm, unit.id, b), tree);
    return { ...base, status: outcome };
  } catch (err) {
    return { ...base, status: "failed", message: err instanceof Error ? err.message : String(err) };
  }
}
