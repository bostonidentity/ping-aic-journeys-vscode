/**
 * Journey-export assembler (D42 / M9 Phase 2). Walks a journey's raw dependency
 * tree and assembles a frodo/PAIC-UI-compatible `{ meta, trees }` bundle. Pure:
 * the `PaicClient` is injected. Reuses the mappers + `getScriptIdIfRef` predicate
 * + `extractScriptBodyRefs` for dependency DISCOVERY, but keeps the raw wire
 * objects for the bundle (faithful export). ESVs are not bundled (TD-1/TD-4); the
 * import discovers referenced ESVs/libs from script bodies at preflight (PD-18 —
 * `meta` carries no dependency manifest).
 */

import type { Connection, NodePayload } from "../domain/types";
import type { PaicClient } from "../paic/client";
import { mapConcurrent } from "../paic/concurrency";
import { mapNodePayload, type RawJourney, type RawScript } from "../paic/mappers";
import { getScriptIdIfRef } from "../paic/script-ref-predicates";
import type { Logger } from "../util/logger";
import { extractScriptBodyRefs } from "../util/script-body-parser";
import { buildExportMeta } from "./meta";
import { type ExportMeta, scriptBodyToExport, stripMask } from "./serialize";

const CONCURRENCY = 10;
const decodeB64 = (b64: unknown): string =>
  typeof b64 === "string" ? Buffer.from(b64, "base64").toString("utf8") : "";

type RawMap = Record<string, Record<string, unknown>>;

/** One tree in a journey bundle — frodo's `SingleTreeExportInterface` subset we
 * populate (saml2 / circlesOfTrust omitted — out of scope). */
export interface SingleTreeExport {
  tree: Record<string, unknown>;
  nodes: RawMap;
  innerNodes: RawMap;
  scripts: RawMap;
  themes: RawMap;
  emailTemplates: RawMap;
  socialIdentityProviders: RawMap;
}

export interface JourneyBundle {
  meta: ExportMeta;
  trees: Record<string, SingleTreeExport>;
}

interface AssembledTree {
  tree: SingleTreeExport;
  /** Inner-journey names referenced by this tree's `InnerTreeEvaluatorNode`s — drives
   * the allLevels closure BFS. No esv/nodeType manifest (PD-18): the import derives
   * those from tree content, never from `meta`. */
  innerJourneys: string[];
}

export type DepthMode = "level1" | "allLevels";

/** Assemble one tree's bundle from raw fetches. Returns null if the journey 404s. */
async function assembleTree(
  client: PaicClient,
  log: Logger,
  realm: string,
  journeyId: string,
): Promise<AssembledTree | null> {
  let raw: RawJourney;
  try {
    raw = await client.getRawJourney(realm, journeyId);
  } catch {
    log.warn(
      { event: "exportJourney.treeMiss", realm, journey: journeyId },
      "Journey not found; not bundled (the import resolves it on the target)",
    );
    return null;
  }

  const nodes: RawMap = {};
  const innerNodes: RawMap = {};
  const domainById = new Map<string, NodePayload>();

  // 1. top-level nodes (resilient to a missing node).
  const entries = Object.entries(raw.nodes ?? {});
  const topRaw = await mapConcurrent(entries, CONCURRENCY, async ([nodeId, ref]) => {
    try {
      return await client.getRawNode(realm, ref.nodeType, nodeId);
    } catch {
      return null;
    }
  });
  entries.forEach(([nodeId], i) => {
    const r = topRaw[i];
    if (!r) return;
    nodes[nodeId] = stripMask(r as Record<string, unknown>);
    domainById.set(nodeId, mapNodePayload(r));
  });

  // 2. PageNode container walk → innerNodes.
  const childRefs: Array<{ id: string; nodeType: string }> = [];
  for (const p of domainById.values()) {
    if (p.nodeType !== "PageNode") continue;
    for (const ref of p.childRefs) {
      if (!domainById.has(ref.id) && !childRefs.some((c) => c.id === ref.id)) childRefs.push(ref);
    }
  }
  if (childRefs.length > 0) {
    const childRaw = await mapConcurrent(childRefs, CONCURRENCY, async (ref) => {
      try {
        return await client.getRawNode(realm, ref.nodeType, ref.id);
      } catch {
        return null;
      }
    });
    childRefs.forEach((ref, i) => {
      const r = childRaw[i];
      if (!r) return;
      innerNodes[ref.id] = stripMask(r as Record<string, unknown>);
      domainById.set(ref.id, mapNodePayload(r));
    });
  }

  // 3. scripts (+ transitive require()'d libraries; library refs walked, ESVs not — PD-18).
  const scripts: RawMap = {};
  const seenScripts = new Set<string>();
  const addScript = async (rs: RawScript): Promise<void> => {
    if (seenScripts.has(rs._id)) return;
    seenScripts.add(rs._id);
    const body = decodeB64(rs.script);
    const cleaned = stripMask(rs as unknown as Record<string, unknown>);
    if (typeof cleaned.script === "string") cleaned.script = scriptBodyToExport(cleaned.script);
    scripts[rs._id] = cleaned;
    const refs = extractScriptBodyRefs(body);
    for (const name of refs.libraryScripts) {
      const lib = await client.getRawScriptByName(realm, name);
      if (lib) await addScript(lib);
    }
  };
  const scriptIds = new Set<string>();
  for (const p of domainById.values()) {
    const sid = getScriptIdIfRef(p);
    if (sid) scriptIds.add(sid);
  }
  for (const sid of scriptIds) {
    if (seenScripts.has(sid)) continue;
    try {
      await addScript(await client.getRawScript(realm, sid));
    } catch {
      // script missing — skip (its ref stays in the node payload).
    }
  }

  // 4. themes / email templates / social IdPs + inner-journey refs.
  const themeIds = new Set<string>();
  const emailNames = new Set<string>();
  const idpNames = new Set<string>();
  const innerJourneys = new Set<string>();
  for (const p of domainById.values()) {
    if (p.nodeType === "PageNode" && p.themeId) themeIds.add(p.themeId);
    if (
      (p.nodeType === "EmailSuspendNode" || p.nodeType === "EmailTemplateNode") &&
      p.emailTemplateName
    ) {
      emailNames.add(p.emailTemplateName);
    }
    if (
      p.nodeType === "SelectIdPNode" ||
      p.nodeType === "SocialProviderHandlerNode" ||
      p.nodeType === "SocialProviderHandlerNodeV2"
    ) {
      for (const n of p.filteredProviders) if (n) idpNames.add(n);
    }
    if (p.nodeType === "InnerTreeEvaluatorNode" && p.tree) innerJourneys.add(p.tree);
  }

  const themes: RawMap = {};
  for (const id of themeIds) {
    const t = await client.getRawTheme(realm, id);
    if (t) themes[t._id ?? id] = stripMask(t as Record<string, unknown>);
  }
  const emailTemplates: RawMap = {};
  for (const name of emailNames) {
    const e = await client.getRawEmailTemplate(name);
    if (e) emailTemplates[e._id ?? name] = stripMask(e as Record<string, unknown>);
  }
  const socialIdentityProviders: RawMap = {};
  for (const name of idpNames) {
    const i = await client.getRawSocialIdp(realm, name);
    if (i) {
      socialIdentityProviders[i._id ?? name] = stripMask(i as unknown as Record<string, unknown>);
    }
  }

  return {
    tree: {
      tree: stripMask(raw as unknown as Record<string, unknown>),
      nodes,
      innerNodes,
      scripts,
      themes,
      emailTemplates,
      socialIdentityProviders,
    },
    innerJourneys: [...innerJourneys],
  };
}

/** Build the full journey bundle. `level1` = selected tree only (inner journeys
 * referenced); `allLevels` = the selected tree + the full inner-journey closure
 * as sibling trees (cycle-guarded). Returns null if the selected journey 404s. */
export async function buildJourneyBundle(
  client: PaicClient,
  conn: Connection,
  realm: string,
  journeyId: string,
  depthMode: DepthMode,
  extensionVersion: string,
  nowIso: string,
  log: Logger,
): Promise<JourneyBundle | null> {
  const trees: Record<string, SingleTreeExport> = {};
  const merge = (a: AssembledTree, id: string) => {
    trees[id] = a.tree;
  };

  if (depthMode === "level1") {
    const a = await assembleTree(client, log, realm, journeyId);
    if (!a) return null;
    merge(a, journeyId);
  } else {
    const visited = new Set<string>();
    const queue = [journeyId];
    while (queue.length > 0) {
      const jid = queue.shift() as string;
      if (visited.has(jid)) continue;
      visited.add(jid);
      const a = await assembleTree(client, log, realm, jid);
      // A missing inner (404) is simply not bundled — the import resolves it on the
      // target (PD-18: bundled-vs-referenced is derived from tree presence, not meta).
      if (!a) continue;
      merge(a, jid);
      for (const j of a.innerJourneys) queue.push(j);
    }
  }

  if (Object.keys(trees).length === 0) return null;

  // meta = pure provenance + informational depthMode (PD-18 — no derived manifest).
  const meta: ExportMeta = {
    ...buildExportMeta(conn, realm, extensionVersion, nowIso),
    depthMode,
  };
  return { meta, trees };
}
