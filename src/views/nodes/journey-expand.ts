import type { Journey, NodePayload } from "../../domain/types";
import { mapConcurrent } from "../../paic/concurrency";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import { MessageNode, type PaicNode } from "./base";
import { InnerJourneyNode } from "./inner-journey";
import { ScriptNode } from "./script";

/** Cap on parallel `getNode` fetches per journey expansion. POC-validated
 * against sb3's 84-journey alpha realm at 10. Q-6 may bump to 20 later. */
const CONCURRENCY = 10;

interface ExpandArgs {
  host: string;
  realm: string;
  journey: Journey;
  visited: readonly string[];
  cache: ClientCache;
  log: Logger;
  /** Tree-parent for the emitted ScriptNode / InnerJourneyNode children. */
  parent?: PaicNode;
}

/**
 * Fetch every node payload for a journey skeleton and emit one `ScriptNode`
 * per ScriptedDecisionNode and one `InnerJourneyNode` per InnerTreeEvaluatorNode,
 * dedup'd by id. "Other" node types are skipped at M1; M3 widens the set.
 */
export async function expandJourney(args: ExpandArgs): Promise<PaicNode[]> {
  const { host, realm, journey, visited, cache, log, parent } = args;
  const client = await cache.get(host);
  const childLog = log.child({ component: "views.journeyExpand" });

  const entries = Object.entries(journey.nodes);
  const payloads = await mapConcurrent(entries, CONCURRENCY, ([nodeId, ref]) =>
    client.getNode(realm, ref.nodeType, nodeId),
  );

  // Stash the per-node payloads on the parent so the inspector can build the
  // journey-diagram's nodeIndex for click-to-drill. Structural check avoids
  // a value-cycle with `journey.ts` / `inner-journey.ts`.
  if (parent && "payloadsByNodeId" in parent) {
    (parent as { payloadsByNodeId?: ReadonlyMap<string, NodePayload> }).payloadsByNodeId = new Map(
      payloads.map((p, i) => [entries[i][0], p]),
    );
  }

  const seenScripts = new Set<string>();
  const seenInners = new Set<string>();
  const children: PaicNode[] = [];
  for (const p of payloads) {
    if (p.nodeType === "ScriptedDecisionNode" && p.scriptId && !seenScripts.has(p.scriptId)) {
      seenScripts.add(p.scriptId);
      children.push(new ScriptNode(host, realm, p.scriptId, cache, log, parent));
    } else if (p.nodeType === "InnerTreeEvaluatorNode" && p.tree && !seenInners.has(p.tree)) {
      seenInners.add(p.tree);
      children.push(
        new InnerJourneyNode(host, realm, p.tree, cache, log, [...visited, journey.id], parent),
      );
    }
  }

  childLog.debug(
    {
      event: "journey.expand.done",
      host,
      realm,
      journey: journey.id,
      nodes: entries.length,
      scripts: seenScripts.size,
      inners: seenInners.size,
    },
    "Journey expanded",
  );

  if (children.length === 0) {
    return [new MessageNode("No script or inner-tree dependencies", "info")];
  }
  return children;
}

/** Expand an inner-journey by id (we don't have its skeleton yet). Performs
 * the cycle check first, then fetches `getJourney` and delegates to
 * `expandJourney`. */
export async function expandInnerJourney(args: {
  host: string;
  realm: string;
  id: string;
  visited: readonly string[];
  cache: ClientCache;
  log: Logger;
  parent?: PaicNode;
}): Promise<PaicNode[]> {
  if (args.visited.includes(args.id)) {
    return [new MessageNode(`[cycle: ${args.id}]`, "cycle")];
  }
  // Reuse `parent.ensureJourney()` when available so the inspector's
  // toSelectPayload fetch and the tree's expansion fetch share one request.
  const journey =
    args.parent && "ensureJourney" in args.parent
      ? await (args.parent as { ensureJourney: () => Promise<Journey> }).ensureJourney()
      : await (await args.cache.get(args.host)).getJourney(args.realm, args.id);
  return expandJourney({
    host: args.host,
    realm: args.realm,
    journey,
    visited: args.visited,
    cache: args.cache,
    log: args.log,
    parent: args.parent,
  });
}
