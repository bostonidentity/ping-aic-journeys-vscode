import type { Journey, NodePayload, Script, Theme } from "../../domain/types";
import { mapConcurrent } from "../../paic/concurrency";
import { getScriptIdIfRef } from "../../paic/script-ref-predicates";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import { MessageNode, type PaicNode } from "./base";
import { EmailTemplateNode } from "./email-template";
import { groupAndSort } from "./grouping";
import { InnerJourneyNode } from "./inner-journey";
import { ScriptNode } from "./script";
import { SocialIdpNode } from "./social-idp";
import { ThemeNode } from "./theme";

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

  // Merge fetched payloads into a single id→payload map. Container-walked
  // children (PageNode.childRefs) get appended below so the inspector + tree
  // surface nested scripts/inners as journey-level deps.
  const payloadById = new Map<string, NodePayload>(payloads.map((p, i) => [entries[i][0], p]));

  // M3 Slice 4 — single-level PageNode container walk. For each PageNode's
  // `childRefs`, fetch the child payload via `getNode` and merge into
  // `payloadById` so the existing emission branches discover its deps.
  // Nested PageNodes inside PageNodes are out-of-scope (dup-id guard makes
  // them a no-op).
  const childRefsToFetch: Array<{ id: string; nodeType: string }> = [];
  for (const p of payloads) {
    if (p.nodeType !== "PageNode") continue;
    for (const ref of p.childRefs) {
      if (!ref.id || !ref.nodeType) continue;
      if (payloadById.has(ref.id)) continue;
      childRefsToFetch.push(ref);
    }
  }
  if (childRefsToFetch.length > 0) {
    const childResults = await mapConcurrent(childRefsToFetch, CONCURRENCY, async (ref) => {
      try {
        const cp = await client.getNode(realm, ref.nodeType, ref.id);
        return { ref, payload: cp };
      } catch (err) {
        childLog.warn(
          {
            event: "journey.expand.pageChildFetchFailed",
            host,
            realm,
            journey: journey.id,
            id: ref.id,
            nodeType: ref.nodeType,
            message: err instanceof Error ? err.message : String(err),
          },
          "Page child fetch failed — skipping",
        );
        return null;
      }
    });
    for (const r of childResults) {
      if (r) payloadById.set(r.ref.id, r.payload);
    }
  }

  // Stash the merged per-node payloads on the parent so the inspector can build
  // the journey-diagram's nodeIndex for click-to-drill. Structural check avoids
  // a value-cycle with `journey.ts` / `inner-journey.ts`.
  if (parent && "payloadsByNodeId" in parent) {
    (parent as { payloadsByNodeId?: ReadonlyMap<string, NodePayload> }).payloadsByNodeId =
      payloadById;
  }

  // M3 polish — eagerly resolve every unique scriptId discovered in this
  // journey's payloads. Lets ScriptNode label with the script NAME (not the
  // UUID), and pre-stashes the body so first-expansion is fetch-free.
  // Failures fall back to id-only labels; journey expansion never blocks on
  // a script fetch.
  const uniqueScriptIds = new Set<string>();
  for (const p of payloadById.values()) {
    const sid = getScriptIdIfRef(p);
    if (sid) uniqueScriptIds.add(sid);
  }
  const scriptIds = [...uniqueScriptIds];
  const scriptResults = await mapConcurrent(scriptIds, CONCURRENCY, async (sid) => {
    try {
      const s = await client.getScript(realm, sid);
      return s;
    } catch (err) {
      childLog.warn(
        {
          event: "journey.expand.scriptFetchFailed",
          host,
          realm,
          journey: journey.id,
          script_id: sid,
          message: err instanceof Error ? err.message : String(err),
        },
        "Script eager-fetch failed — tree label falls back to id",
      );
      return null;
    }
  });
  const scriptById = new Map<string, Script>(
    scriptResults
      .map((s, i) => (s ? ([scriptIds[i], s] as const) : null))
      .filter((e): e is readonly [string, Script] => e !== null),
  );

  // Pre-resolve themes: if any PageNode carries a themeId, fetch the realm's
  // theme list once and build a lookup map. Lets each ThemeNode show the
  // human name instead of the UUID and lets the inspector card skip the
  // per-click fetch.
  const themeById = new Map<string, Theme>();
  const wantsThemes = [...payloadById.values()].some((p) => p.nodeType === "PageNode" && p.themeId);
  if (wantsThemes) {
    try {
      const themes = await client.listThemes(realm);
      for (const t of themes) themeById.set(t.id, t);
    } catch (err) {
      childLog.warn(
        {
          event: "journey.expand.themeListFailed",
          host,
          realm,
          journey: journey.id,
          message: err instanceof Error ? err.message : String(err),
        },
        "Theme list fetch failed — tree label falls back to id",
      );
    }
  }

  const seenScripts = new Set<string>();
  const seenInners = new Set<string>();
  const seenThemes = new Set<string>();
  const seenEmails = new Set<string>();
  const seenIdps = new Set<string>();
  const children: PaicNode[] = [];
  for (const p of payloadById.values()) {
    // Script edges (D19 predicate handles all 7 kinds).
    const scriptId = getScriptIdIfRef(p);
    if (scriptId && !seenScripts.has(scriptId)) {
      seenScripts.add(scriptId);
      const resolved = scriptById.get(scriptId);
      children.push(new ScriptNode(host, realm, scriptId, cache, log, parent, [], resolved));
    }

    // Inner-tree edge.
    if (p.nodeType === "InnerTreeEvaluatorNode" && p.tree && !seenInners.has(p.tree)) {
      seenInners.add(p.tree);
      children.push(
        new InnerJourneyNode(host, realm, p.tree, cache, log, [...visited, journey.id], parent),
      );
    }

    // M3 Slice 3 — theme edge via PageNode.stage. Pre-resolved above so the
    // tree label can show the name + the inspector card skips its fetch.
    if (p.nodeType === "PageNode" && p.themeId && !seenThemes.has(p.themeId)) {
      seenThemes.add(p.themeId);
      const resolved = themeById.get(p.themeId);
      children.push(new ThemeNode(host, realm, p.themeId, cache, log, parent, resolved));
    }

    // M3 Slice 3 — email-template edge.
    if (
      (p.nodeType === "EmailSuspendNode" || p.nodeType === "EmailTemplateNode") &&
      p.emailTemplateName &&
      !seenEmails.has(p.emailTemplateName)
    ) {
      seenEmails.add(p.emailTemplateName);
      children.push(new EmailTemplateNode(host, realm, p.emailTemplateName, cache, log, parent));
    }

    // M3 Slice 3 — social-idp edges (one node may emit multiple).
    let filtered: readonly string[] | null = null;
    if (
      p.nodeType === "SocialProviderHandlerNode" ||
      p.nodeType === "SocialProviderHandlerNodeV2" ||
      p.nodeType === "SelectIdPNode"
    ) {
      filtered = p.filteredProviders;
    }
    if (filtered) {
      for (const name of filtered) {
        if (!name || seenIdps.has(name)) continue;
        seenIdps.add(name);
        children.push(new SocialIdpNode(host, realm, name, cache, log, parent));
      }
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
      themes: seenThemes.size,
      email_templates: seenEmails.size,
      social_idps: seenIdps.size,
    },
    "Journey expanded",
  );

  if (children.length === 0) {
    return [new MessageNode("No dependencies discovered", "info")];
  }
  return groupAndSort(children);
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
