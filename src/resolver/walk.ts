/**
 * D35 — forward dep walker. Single-root BFS over the transitive dep graph,
 * concurrency-bounded via `mapConcurrent`. Pure data output
 * (`ResolvedGraph`) — no `vscode` coupling.
 *
 * Lives in `src/resolver/` and is isolated from the lazy tree's walk in
 * `src/views/nodes/journey-expand.ts` + `src/views/nodes/script-expand.ts`
 * per D21. The two walks intentionally duplicate *logic* (not
 * implementation): one produces `PaicNode` tree items for the sidebar; the
 * other produces typed graph data for the inspector card's Full / Flat
 * views. They share underlying PaicClient calls and reuse the pure
 * helpers `getScriptIdIfRef` (D19) and `extractScriptBodyRefs` (D20).
 */

import type {
  ResolvedEdge,
  ResolvedGraph,
  ResolvedNode,
  ResolvedNodeKind,
  RootDescriptor,
} from "../domain/resolved-graph";
import { keyOf } from "../domain/resolved-graph";
import type { Journey, NodePayload, Script } from "../domain/types";
import type { PaicClient } from "../paic/client";
import { mapConcurrent } from "../paic/concurrency";
import { getScriptIdIfRef } from "../paic/script-ref-predicates";
import type { Logger } from "../util/logger";
import { extractScriptBodyRefs } from "../util/script-body-parser";

/** Per-layer parallel-fetch cap. Matches the lazy tree's value
 * (`src/views/nodes/journey-expand.ts:CONCURRENCY`). POC-validated at 10
 * against sb3. Nested layers may briefly exceed this when multiple
 * journeys-in-the-same-layer each fan out to their own getNode batch — a
 * future global semaphore could clamp the total. Not a Slice 1 concern. */
const WALK_CONCURRENCY = 10;

export interface WalkDeps {
  client: PaicClient;
  log: Logger;
}

/** Child reference emitted by `fetchChildren`. Lacks `depth` and `key` —
 * the BFS loop computes those when promoting to a `ResolvedNode`. */
interface ChildRef {
  kind: ResolvedNodeKind;
  id: string;
  displayName: string;
  via: string;
  /** Only meaningful for script-kind children; `true` when the resolved
   * script's `context === "LIBRARY"`. */
  isLibrary?: boolean;
  /** Only meaningful for esv-kind children; classifies the ESV by its
   * tenant-side definition (variable / secret / missing). Lifted from
   * the per-walk ESV index — see `WalkState.esvIndex`. */
  esvKind?: "variable" | "secret" | "missing";
}

const LIBRARY_CONTEXT = "LIBRARY";

interface WalkState {
  client: PaicClient;
  log: Logger;
  realm: string;
  /** Journeys we've already fetched (root + any inner-journey we descend
   * into). Saves a re-fetch when the same journey is referenced multiple
   * times in the graph. */
  journeys: Map<string, Journey>;
  /** Scripts we've already fetched for body parsing or displayName
   * resolution. */
  scripts: Map<string, Script>;
  /** Single-flight in-flight ESV index build. The FIRST ESV-emitting
   * `fetchChildrenForScript` call kicks off the fetch and stores the
   * promise here; every concurrent caller awaits the SAME promise.
   *
   * Without single-flight, parallel `fetchChildrenForScript` calls
   * (the BFS fans out per-script via `mapConcurrent`) raced past a sync
   * "already attempted" flag and classified their ESVs against a still-
   * `null` index — leaving early-layer ESVs in the unclassified
   * fallback bucket while later-layer ESVs landed in the right group.
   *
   * Resolves to the index map on success, or `null` on fetch failure
   * (graceful fallback to the unclassified `── ESVs ──` group). */
  esvIndexBuild: Promise<Map<string, "variable" | "secret"> | null> | null;
}

/** Lazily build the tenant ESV index (variables + secrets). Single-flight:
 * the first caller kicks off the fetch; every concurrent caller awaits
 * the same shared promise. */
function ensureEsvIndex(state: WalkState): Promise<Map<string, "variable" | "secret"> | null> {
  if (state.esvIndexBuild) return state.esvIndexBuild;
  state.esvIndexBuild = (async () => {
    try {
      const [variables, secrets] = await Promise.all([
        state.client.listVariables(state.realm),
        state.client.listSecrets(state.realm),
      ]);
      const idx = new Map<string, "variable" | "secret">();
      for (const v of variables) idx.set(v.name, "variable");
      for (const s of secrets) idx.set(s.name, "secret");
      return idx;
    } catch (err) {
      state.log.warn(
        {
          event: "resolver.walk.esvIndexFailed",
          realm: state.realm,
          message: err instanceof Error ? err.message : String(err),
        },
        "Failed to build per-walk ESV index — ESV refs will render without variable/secret split",
      );
      return null;
    }
  })();
  return state.esvIndexBuild;
}

function classifyEsv(
  index: Map<string, "variable" | "secret"> | null,
  name: string,
): "variable" | "secret" | "missing" | undefined {
  if (!index) return undefined; // fetch failed; no classification
  return index.get(name) ?? "missing";
}

/** Build the resolved forward-dep graph for a single root. BFS, layered,
 * concurrency-bounded. Cycles and cross-layer dups become edges with
 * `cycle: true`. Same-layer dups (e.g. two journey nodes both pointing at
 * the same script) become extra edges to the single shared node, NOT
 * marked `cycle`. */
export async function walkRoot(deps: WalkDeps, root: RootDescriptor): Promise<ResolvedGraph> {
  const start = Date.now();
  const log = deps.log.child({
    component: "resolver.walk",
    root_kind: root.kind,
    root_id: root.id,
    realm: root.realm,
  });
  const state: WalkState = {
    client: deps.client,
    log,
    realm: root.realm,
    journeys: new Map(),
    scripts: new Map(),
    esvIndexBuild: null,
  };

  const rootNode = await materializeRoot(state, root);
  const rootKey = rootNode.key;
  const nodes: Record<string, ResolvedNode> = { [rootKey]: rootNode };
  const edges: ResolvedEdge[] = [];

  let currentLayer: string[] = [rootKey];
  let depth = 0;
  while (currentLayer.length > 0) {
    const layerResults = await mapConcurrent(currentLayer, WALK_CONCURRENCY, async (parentKey) => {
      const parent = nodes[parentKey];
      const children = await fetchChildren(state, parent);
      return { parentKey, children };
    });

    const nextLayer: string[] = [];
    const seenInLayer = new Set<string>();
    for (const { parentKey, children } of layerResults) {
      for (const child of children) {
        const childKey = keyOf(child.kind, child.id);
        if (childKey in nodes) {
          // Cross-layer dup or true cycle — record the edge, don't re-walk.
          edges.push({ fromKey: parentKey, toKey: childKey, via: child.via, cycle: true });
        } else if (seenInLayer.has(childKey)) {
          // Same-layer dup (two parents at this depth point at the same
          // child). Extra edge, no new node, NOT marked `cycle`.
          edges.push({ fromKey: parentKey, toKey: childKey, via: child.via });
        } else {
          nodes[childKey] = {
            key: childKey,
            kind: child.kind,
            id: child.id,
            displayName: child.displayName,
            depth: depth + 1,
            ...(child.isLibrary === undefined ? {} : { isLibrary: child.isLibrary }),
            ...(child.esvKind === undefined ? {} : { esvKind: child.esvKind }),
          };
          edges.push({ fromKey: parentKey, toKey: childKey, via: child.via });
          seenInLayer.add(childKey);
          nextLayer.push(childKey);
        }
      }
    }
    currentLayer = nextLayer;
    depth++;
  }

  const durationMs = Date.now() - start;
  log.debug(
    {
      event: "resolver.walk.done",
      node_count: Object.keys(nodes).length,
      edge_count: edges.length,
      duration_ms: durationMs,
    },
    "Walk complete",
  );
  return { rootKey, nodes, edges, durationMs };
}

async function materializeRoot(state: WalkState, root: RootDescriptor): Promise<ResolvedNode> {
  if (root.kind === "journey" || root.kind === "innerJourney") {
    const key = keyOf("journey", root.id);
    const journey = await state.client.getJourney(state.realm, root.id);
    state.journeys.set(root.id, journey);
    return { key, kind: "journey", id: root.id, displayName: journey.id, depth: 0 };
  }
  // script / libraryScript collapse to kind "script"
  const key = keyOf("script", root.id);
  const script = await state.client.getScript(state.realm, root.id);
  state.scripts.set(root.id, script);
  const node: ResolvedNode = {
    key,
    kind: "script",
    id: root.id,
    displayName: script.name,
    depth: 0,
  };
  if (script.context === LIBRARY_CONTEXT) node.isLibrary = true;
  return node;
}

function fetchChildren(state: WalkState, node: ResolvedNode): Promise<ChildRef[]> {
  switch (node.kind) {
    case "journey":
      return fetchChildrenForJourney(state, node.id);
    case "script":
      return fetchChildrenForScript(state, node.id);
    case "esv":
    case "theme":
    case "emailTemplate":
    case "socialIdp":
      return Promise.resolve([]);
  }
}

async function fetchChildrenForJourney(state: WalkState, journeyId: string): Promise<ChildRef[]> {
  let journey = state.journeys.get(journeyId);
  if (!journey) {
    journey = await state.client.getJourney(state.realm, journeyId);
    state.journeys.set(journeyId, journey);
  }

  // Layer 1: fetch every direct node payload (one getNode per nodes[].entry)
  const entries = Object.entries(journey.nodes);
  const directResults = await mapConcurrent(entries, WALK_CONCURRENCY, async ([nodeId, ref]) => {
    try {
      const payload = await state.client.getNode(state.realm, ref.nodeType, nodeId);
      return { nodeId, payload };
    } catch (err) {
      state.log.warn(
        {
          event: "resolver.walk.nodeFetchFailed",
          journey_id: journeyId,
          node_id: nodeId,
          node_type: ref.nodeType,
          message: err instanceof Error ? err.message : String(err),
        },
        "Node fetch failed — skipping",
      );
      return null;
    }
  });

  type Frame = { payload: NodePayload; fromContainer: boolean };
  const frames: Frame[] = [];
  const directIds = new Set<string>();
  for (const r of directResults) {
    if (r) {
      directIds.add(r.nodeId);
      frames.push({ payload: r.payload, fromContainer: false });
    }
  }

  // Layer 2 (single level): walk PageNode.childRefs and merge their
  // payloads into the frame list. Nested PageNode-inside-PageNode is out
  // of scope — matches the lazy tree's M3 Slice 4 rule.
  const containerRefs: Array<{ id: string; nodeType: string }> = [];
  for (const { payload } of frames) {
    if (payload.nodeType !== "PageNode") continue;
    for (const r of payload.childRefs) {
      if (!r.id || !r.nodeType) continue;
      if (directIds.has(r.id)) continue;
      containerRefs.push(r);
    }
  }
  if (containerRefs.length > 0) {
    const containerPayloads = await mapConcurrent(containerRefs, WALK_CONCURRENCY, async (ref) => {
      try {
        return await state.client.getNode(state.realm, ref.nodeType, ref.id);
      } catch (err) {
        state.log.warn(
          {
            event: "resolver.walk.pageChildFetchFailed",
            journey_id: journeyId,
            id: ref.id,
            node_type: ref.nodeType,
            message: err instanceof Error ? err.message : String(err),
          },
          "Page-child node fetch failed — skipping",
        );
        return null;
      }
    });
    for (const cp of containerPayloads) {
      if (cp) frames.push({ payload: cp, fromContainer: true });
    }
  }

  // Pre-resolve every unique scriptId to a Script so children can carry the
  // human-readable name instead of the UUID. Failures fall back to the id.
  const uniqueScriptIds = new Set<string>();
  for (const f of frames) {
    const sid = getScriptIdIfRef(f.payload);
    if (sid) uniqueScriptIds.add(sid);
  }
  const scriptIds = [...uniqueScriptIds];
  const scriptResults = await mapConcurrent(scriptIds, WALK_CONCURRENCY, async (sid) => {
    const existing = state.scripts.get(sid);
    if (existing) return existing;
    try {
      const s = await state.client.getScript(state.realm, sid);
      state.scripts.set(sid, s);
      return s;
    } catch (err) {
      state.log.warn(
        {
          event: "resolver.walk.scriptFetchFailed",
          journey_id: journeyId,
          script_id: sid,
          message: err instanceof Error ? err.message : String(err),
        },
        "Script displayName fetch failed — falling back to id",
      );
      return null;
    }
  });
  const scriptById = new Map<string, Script>();
  for (let i = 0; i < scriptIds.length; i++) {
    const s = scriptResults[i];
    if (s) scriptById.set(scriptIds[i], s);
  }

  // Emit children, deduplicated per kind across all frames.
  const children: ChildRef[] = [];
  const seen = {
    script: new Set<string>(),
    inner: new Set<string>(),
    theme: new Set<string>(),
    email: new Set<string>(),
    idp: new Set<string>(),
  };

  for (const { payload, fromContainer } of frames) {
    const scriptId = getScriptIdIfRef(payload);
    if (scriptId && !seen.script.has(scriptId)) {
      seen.script.add(scriptId);
      const resolved = scriptById.get(scriptId);
      const via = fromContainer ? `PageNode → ${payload.nodeType}` : payload.nodeType;
      children.push({
        kind: "script",
        id: scriptId,
        displayName: resolved?.name ?? scriptId,
        via,
        isLibrary: resolved?.context === LIBRARY_CONTEXT ? true : undefined,
      });
    }

    if (
      payload.nodeType === "InnerTreeEvaluatorNode" &&
      payload.tree &&
      !seen.inner.has(payload.tree)
    ) {
      seen.inner.add(payload.tree);
      const via = fromContainer ? "PageNode → InnerTreeEvaluatorNode" : "InnerTreeEvaluatorNode";
      children.push({
        kind: "journey",
        id: payload.tree,
        displayName: payload.tree,
        via,
      });
    }

    if (payload.nodeType === "PageNode" && payload.themeId && !seen.theme.has(payload.themeId)) {
      seen.theme.add(payload.themeId);
      children.push({
        kind: "theme",
        id: payload.themeId,
        displayName: payload.themeId,
        via: "PageNode",
      });
    }

    if (
      (payload.nodeType === "EmailSuspendNode" || payload.nodeType === "EmailTemplateNode") &&
      payload.emailTemplateName &&
      !seen.email.has(payload.emailTemplateName)
    ) {
      seen.email.add(payload.emailTemplateName);
      children.push({
        kind: "emailTemplate",
        id: payload.emailTemplateName,
        displayName: payload.emailTemplateName,
        via: payload.nodeType,
      });
    }

    let idpNames: readonly string[] | null = null;
    let idpVia: string | null = null;
    if (
      payload.nodeType === "SocialProviderHandlerNode" ||
      payload.nodeType === "SocialProviderHandlerNodeV2" ||
      payload.nodeType === "SelectIdPNode"
    ) {
      idpNames = payload.filteredProviders;
      idpVia = payload.nodeType;
    }
    if (idpNames && idpVia) {
      for (const name of idpNames) {
        if (!name || seen.idp.has(name)) continue;
        seen.idp.add(name);
        children.push({ kind: "socialIdp", id: name, displayName: name, via: idpVia });
      }
    }
  }

  return children;
}

async function fetchChildrenForScript(state: WalkState, scriptId: string): Promise<ChildRef[]> {
  let script = state.scripts.get(scriptId);
  if (!script) {
    try {
      script = await state.client.getScript(state.realm, scriptId);
      state.scripts.set(scriptId, script);
    } catch (err) {
      state.log.warn(
        {
          event: "resolver.walk.scriptBodyFetchFailed",
          script_id: scriptId,
          message: err instanceof Error ? err.message : String(err),
        },
        "Script body fetch failed — treating as leaf",
      );
      return [];
    }
  }

  const refs = extractScriptBodyRefs(script.body);
  const children: ChildRef[] = [];

  if (refs.libraryScripts.length > 0) {
    const libResults = await mapConcurrent(refs.libraryScripts, WALK_CONCURRENCY, async (name) => {
      try {
        const found = await state.client.getScriptByName(state.realm, name);
        return { name, found };
      } catch (err) {
        state.log.warn(
          {
            event: "resolver.walk.libraryLookupFailed",
            script_id: scriptId,
            library_name: name,
            message: err instanceof Error ? err.message : String(err),
          },
          "Library script lookup failed — skipping",
        );
        return { name, found: null };
      }
    });
    for (const { name, found } of libResults) {
      if (!found) {
        state.log.warn(
          { event: "resolver.walk.missingLibrary", script_id: scriptId, library_name: name },
          "Library script not found in tenant — no child emitted",
        );
        continue;
      }
      state.scripts.set(found.id, found);
      children.push({
        kind: "script",
        id: found.id,
        displayName: found.name,
        via: "require()",
        // Library scripts found via `require()` are always context=LIBRARY in
        // practice; fall back to the require() syntactic signal if context
        // isn't set on this tenant's response.
        isLibrary: found.context === LIBRARY_CONTEXT || !found.context ? true : undefined,
      });
    }
  }

  if (refs.esvs.length > 0) {
    // Lazy-fetch the tenant-wide ESV index ONCE per walk via a shared
    // in-flight promise. Concurrent fetchChildrenForScript calls all
    // await the same resolved index — without single-flight, parallel
    // callers raced past a sync flag and classified their ESVs against
    // a still-`null` index. Lets every emitted esv child be tagged as
    // variable / secret / missing so the resolved + sidebar views can
    // split them into divider groups with distinct icons (mirrors D22).
    const index = await ensureEsvIndex(state);
    for (const name of refs.esvs) {
      const esvKind = classifyEsv(index, name);
      children.push({
        kind: "esv",
        id: name,
        displayName: name,
        via: "string literal",
        ...(esvKind === undefined ? {} : { esvKind }),
      });
    }
  }

  return children;
}
