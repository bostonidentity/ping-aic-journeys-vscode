/**
 * Import dependency-closure discovery (TD-9, M9 Phase 4 Batch 2). Pure.
 *
 * A self-contained bundle (TD-2/TD-6) carries only the top-level script, never
 * its libraries' bodies — and import is file-first with no source connection,
 * so we can't recurse `lib → lib`. We discover the **direct** dependencies by
 * running the D20 ref extractor (`extractScriptBodyRefs`) on the bundle script's
 * own body, then the pre-flight existence-checks each ref against the target.
 *
 * Level-1, existence-only by design — a referenced library missing on the
 * target is name-terminal (no body to read, no UUID resolvable). No `vscode`,
 * no network.
 */

import { extractScriptBodyRefs } from "../util/script-body-parser";
import type { ImportComponent } from "./parse";

/** A dependency referenced by a bundle script, before target existence-check. */
export interface DiscoveredRef {
  /** `script` = a `require()`'d library (matched on the target by name);
   * `esv` = a dotted ESV reference. */
  kind: "script" | "esv";
  /** The reference as it appears in source — a library name or a dotted ESV
   * name (`esv.foo.bar`). For scripts this is the cross-env identity (TD-9). */
  name: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Decode a bundle script body back to plain source. The bundle carries it
 * JSON-stringified (`serialize.ts:scriptBodyToExport`); tolerate a non-string /
 * malformed body by yielding "". */
function bundleScriptSource(raw: Record<string, unknown>): string {
  const body = str(raw.script);
  if (body === undefined) return "";
  try {
    const parsed = JSON.parse(body);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return "";
  }
}

/**
 * Extract the deduped, sorted set of direct dependency refs (libraries + ESVs)
 * across every `script` component in a bundle. Non-script components are
 * ignored. Returns `[]` when nothing references a dep.
 */
export function discoverScriptDeps(rawComponents: readonly ImportComponent[]): DiscoveredRef[] {
  const libs = new Set<string>();
  const esvs = new Set<string>();
  for (const comp of rawComponents) {
    if (comp.kind !== "script") continue;
    const refs = extractScriptBodyRefs(bundleScriptSource(comp.raw));
    for (const name of refs.libraryScripts) libs.add(name);
    for (const name of refs.esvs) esvs.add(name);
  }
  const out: DiscoveredRef[] = [];
  for (const name of [...libs].sort()) out.push({ kind: "script", name });
  for (const name of [...esvs].sort()) out.push({ kind: "esv", name });
  return out;
}

/** Node types used + inner journeys referenced-but-not-bundled by a journey
 * bundle's units — the inputs to the import gates (PD-7). */
export interface JourneyRefs {
  /** Every `_type._id` across the journeys' nodes + inner nodes (deduped, sorted). */
  nodeTypes: string[];
  /** `InnerTreeEvaluatorNode.tree` refs NOT present as a bundled journey unit
   * (deduped, sorted) — these must already exist on the target (TD-12). */
  innerJourneys: string[];
}

/**
 * Walk a journey bundle's decomposed units (`kind: "journey"` from `parse.ts`,
 * nodes folded into `raw`) for the gate inputs: the node types it uses and the
 * inner journeys it references but does not bundle. Pure; non-journey components
 * are ignored, so a leaf bundle yields `{ nodeTypes: [], innerJourneys: [] }`.
 */
export function discoverJourneyRefs(rawComponents: readonly ImportComponent[]): JourneyRefs {
  const bundled = new Set(rawComponents.filter((c) => c.kind === "journey").map((c) => c.id));
  const nodeTypes = new Set<string>();
  const innerJourneys = new Set<string>();
  for (const comp of rawComponents) {
    if (comp.kind !== "journey") continue;
    const nodes = isRecord(comp.raw.nodes) ? comp.raw.nodes : {};
    const innerNodes = isRecord(comp.raw.innerNodes) ? comp.raw.innerNodes : {};
    for (const node of [...Object.values(nodes), ...Object.values(innerNodes)]) {
      if (!isRecord(node)) continue;
      const type = isRecord(node._type) ? str(node._type._id) : undefined;
      if (type) nodeTypes.add(type);
      if (type === "InnerTreeEvaluatorNode") {
        const ref = str(node.tree);
        if (ref && !bundled.has(ref)) innerJourneys.add(ref);
      }
    }
  }
  return { nodeTypes: [...nodeTypes].sort(), innerJourneys: [...innerJourneys].sort() };
}
