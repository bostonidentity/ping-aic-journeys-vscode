/**
 * D36 — per-realm reverse-dependency index scanner. Sweeps every entity in
 * one realm (journeys, scripts incl. library scripts, themes, social IdPs,
 * ESVs) and produces a `RealmIndexEntry` with an inverted-reference map
 * keyed by target.
 *
 * Lives in `src/realm-index/` and is isolated from `src/resolver/` per
 * D21 — the two layers reuse the same pure primitives (`getScriptIdIfRef`,
 * `extractScriptBodyRefs`) but never import each other.
 *
 * Per-step errors (one failed node payload, one failed script fetch) are
 * logged + skipped — the build never throws on partial data; only the
 * outer total failure (e.g. `listJourneys` rejects) rejects the promise.
 * This matches `walkRoot`'s defensive style — a Search page that's 99%
 * complete is more useful than no Search page.
 *
 * Concurrency: ONE shared `makeLimiter(BUILD_CONCURRENCY)` per build,
 * threaded through every `PaicClient` call across every phase. The build's
 * fan-out points nest (scanJourney runs N journeys, each fanning out
 * getNode) — a single limiter keeps total in-flight at exactly
 * `BUILD_CONCURRENCY` rather than letting nested pools multiply. The
 * limiter is a per-build instance, never shared with the tree-lazy or
 * resolver caches (D21). See the "Build concurrency" note in
 * `docs/design-plan.md` D36 + the `docs/lessons.md` 2026-05-19 entry.
 */

import {
  type EntityKind,
  entityKeyOf,
  type RealmIndexEntity,
  type RealmIndexEntry,
  type ReverseRef,
} from "../domain/realm-index";
import type { EmailTemplate, Journey, NodePayload, Script } from "../domain/types";
import type { PaicClient } from "../paic/client";
import { type Limiter, makeLimiter } from "../paic/concurrency";
import { getScriptIdIfRef } from "../paic/script-ref-predicates";
import type { Logger } from "../util/logger";
import { extractScriptBodyRefs } from "../util/script-body-parser";

/** Total in-flight HTTP cap for one build, across all phases. Matches the
 * tree + resolver value (D16). A realm-index build is the project's
 * heaviest call pattern (~2,300 calls for sb3 `alpha`); a true global cap
 * keeps it gentle on the tenant — nested fan-out previously burst to ~80
 * concurrent (see `docs/lessons.md` 2026-05-19). */
const BUILD_CONCURRENCY = 10;

const LIBRARY_CONTEXT = "LIBRARY";

/** Coarse build-phase progress, surfaced to the Search page's progress
 * bar. The `journeys` phase is determinate (`done` / `total`); the
 * script-BFS phase has no known total upfront so it reports `phase` only. */
export interface BuildProgress {
  phase: "preparing" | "journeys" | "scripts" | "finishing";
  done?: number;
  total?: number;
}

export interface RealmIndexBuildDeps {
  client: PaicClient;
  log: Logger;
  /** Optional progress sink. Invoked once per completed journey during
   * the journey-scan phase + once per phase transition. The caller is
   * expected to coalesce (the Search panel throttles to ~5 Hz). */
  onProgress?: (p: BuildProgress) => void;
}

/** State shared across the scan's helper functions. Mutable so the BFS
 * can incrementally grow it without threading every collection through
 * argument lists. */
interface BuildState {
  client: PaicClient;
  log: Logger;
  realm: string;
  /** Progress sink (from `deps.onProgress`). Lives on state so the
   * script-BFS phase can emit per-script progress. */
  onProgress?: (p: BuildProgress) => void;
  /** Shared per-build concurrency limiter — every `client.*` call routes
   * through `limit.run(...)` so total in-flight stays at BUILD_CONCURRENCY. */
  limit: Limiter;
  entities: Map<string, RealmIndexEntity>;
  /** edgeKey (`${fromKey}|${toKey}|${via}`) used to dedupe — same
   * (from, to, via) is emitted only once even if multiple journey nodes
   * point at the same target via the same kind. The inverted map below
   * is the consumer-facing shape. */
  edgeKeys: Set<string>;
  /** target entityKey → list of ReverseRef. Updated in lockstep with
   * `edgeKeys` (an edge that's already in `edgeKeys` is skipped). */
  inboundRefs: Map<string, ReverseRef[]>;
  /** Script body cache so the BFS over `require()` chains avoids
   * re-fetching the same library script. */
  scriptsById: Map<string, Script>;
  /** Tenant ESV name → kind map. Populated once; lookup-only thereafter. */
  esvByName: Map<string, "variable" | "secret">;
}

export async function buildRealmIndex(
  deps: RealmIndexBuildDeps,
  host: string,
  realm: string,
): Promise<RealmIndexEntry> {
  const start = Date.now();
  const log = deps.log.child({ component: "realm-index.build", host, realm });
  log.info({ event: "realm-index.build.start" }, "Building realm index");

  const state: BuildState = {
    client: deps.client,
    log,
    realm,
    onProgress: deps.onProgress,
    limit: makeLimiter(BUILD_CONCURRENCY),
    entities: new Map(),
    edgeKeys: new Set(),
    inboundRefs: new Map(),
    scriptsById: new Map(),
    esvByName: new Map(),
  };

  const emit = (p: BuildProgress): void => deps.onProgress?.(p);

  // 1) Tenant-wide ESV index + the journey list run concurrently — the
  //    ESV index feeds only the later script phase, so there's no reason
  //    to wait for it before listing journeys.
  emit({ phase: "preparing" });
  const [, journeys] = await Promise.all([
    loadEsvIndex(state),
    state.limit.run(() => state.client.listJourneys(realm)),
  ]);
  log.debug(
    { event: "realm-index.build.journeysListed", count: journeys.length },
    "Listed journeys",
  );

  const journeyByName = new Map<string, Journey>();
  for (const j of journeys) {
    journeyByName.set(j.id, j);
    materializeEntity(state, {
      key: entityKeyOf("journey", j.id),
      kind: "journey",
      id: j.id,
      displayName: j.id,
    });
  }

  // 2) Scan every journey in parallel — the determinate progress phase.
  //    The shared limiter (not the loop shape) bounds total in-flight, so
  //    a plain `Promise.all` is correct. Progress is reported per
  //    completed journey. Builds the journey→component edges (journey→script
  //    etc.); the script→lib/esv edges are built by `scanAllScripts` below.
  let scanned = 0;
  emit({ phase: "journeys", done: 0, total: journeys.length });
  await Promise.all(
    journeys.map((journey) =>
      scanJourney(state, journey).then(() => {
        scanned++;
        emit({ phase: "journeys", done: scanned, total: journeys.length });
      }),
    ),
  );

  // 3) Full-realm component enumeration runs concurrently. `scanAllScripts`
  //    lists EVERY script (bodies included) and builds all script→lib/esv edges
  //    in-memory — superseding the old journey-closure BFS (no per-script fetch,
  //    no per-lib `getScriptByName`). The phases touch disjoint slices of the
  //    shared `BuildState` maps; the synchronous `materializeEntity`/`addEdge`
  //    writes never tear (JS is single-threaded; awaits are the only yields).
  emit({ phase: "scripts" });
  await Promise.all([
    scanAllScripts(state),
    scanThemes(state, journeyByName),
    scanSocialIdps(state),
    scanAllEmailTemplates(state),
  ]);
  emit({ phase: "finishing" });

  // 4) Materialize the per-kind counts.
  const counts: Record<EntityKind, number> = {
    journey: 0,
    script: 0,
    esv: 0,
    theme: 0,
    emailTemplate: 0,
    socialIdp: 0,
  };
  for (const e of state.entities.values()) counts[e.kind]++;

  const entities: Record<string, RealmIndexEntity> = {};
  for (const [k, v] of state.entities) entities[k] = v;
  const inboundRefs: Record<string, ReverseRef[]> = {};
  for (const [k, v] of state.inboundRefs) inboundRefs[k] = v;

  const durationMs = Date.now() - start;
  log.info(
    {
      event: "realm-index.build.done",
      entity_count: state.entities.size,
      ref_count: state.edgeKeys.size,
      duration_ms: durationMs,
    },
    "Realm index built",
  );

  return {
    host,
    realm,
    entities,
    inboundRefs,
    counts,
    builtAt: Date.now(),
    scanDurationMs: durationMs,
  };
}

async function loadEsvIndex(state: BuildState): Promise<void> {
  try {
    const [variables, secrets] = await Promise.all([
      state.limit.run(() => state.client.listVariables(state.realm)),
      state.limit.run(() => state.client.listSecrets(state.realm)),
    ]);
    for (const v of variables) state.esvByName.set(v.name, "variable");
    for (const s of secrets) state.esvByName.set(s.name, "secret");
    state.log.debug(
      {
        event: "realm-index.build.esvIndexLoaded",
        variable_count: variables.length,
        secret_count: secrets.length,
      },
      "Loaded tenant ESV index",
    );
  } catch (err) {
    state.log.warn(
      {
        event: "realm-index.build.esvIndexFailed",
        message: err instanceof Error ? err.message : String(err),
      },
      "Failed to load tenant ESV index — ESV refs in script bodies will not be promoted to entities",
    );
  }
}

async function scanJourney(state: BuildState, journey: Journey): Promise<void> {
  const fromKey = entityKeyOf("journey", journey.id);

  // Layer 1: every direct node payload. Each fetch routes through the
  // shared limiter, so all journeys' getNode calls compete for one cap.
  const entries = Object.entries(journey.nodes);
  const directResults = await Promise.all(
    entries.map(([nodeId, ref]) =>
      state.limit.run(async () => {
        try {
          const payload = await state.client.getNode(state.realm, ref.nodeType, nodeId);
          return { nodeId, payload };
        } catch (err) {
          state.log.warn(
            {
              event: "realm-index.build.nodeFetchFailed",
              journey_id: journey.id,
              node_id: nodeId,
              node_type: ref.nodeType,
              message: err instanceof Error ? err.message : String(err),
            },
            "Node fetch failed — skipping",
          );
          return null;
        }
      }),
    ),
  );

  // `nodeId` is the journey node `_id` — carried so each edge records its
  // node instance (D37 amendment): two same-type nodes pointing at the
  // same target stay distinct edges.
  type Frame = { payload: NodePayload; fromContainer: boolean; nodeId: string };
  const frames: Frame[] = [];
  const directIds = new Set<string>();
  for (const r of directResults) {
    if (r) {
      directIds.add(r.nodeId);
      frames.push({ payload: r.payload, fromContainer: false, nodeId: r.nodeId });
    }
  }

  // Layer 2 (single level): walk PageNode.childRefs.
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
    const containerPayloads = await Promise.all(
      containerRefs.map((ref) =>
        state.limit.run(async () => {
          try {
            const payload = await state.client.getNode(state.realm, ref.nodeType, ref.id);
            return { nodeId: ref.id, payload };
          } catch (err) {
            state.log.warn(
              {
                event: "realm-index.build.pageChildFetchFailed",
                journey_id: journey.id,
                id: ref.id,
                node_type: ref.nodeType,
                message: err instanceof Error ? err.message : String(err),
              },
              "Page-child node fetch failed — skipping",
            );
            return null;
          }
        }),
      ),
    );
    for (const cp of containerPayloads) {
      if (cp) frames.push({ payload: cp.payload, fromContainer: true, nodeId: cp.nodeId });
    }
  }

  // Emit journey-level edges by scanning each frame's payload.
  for (const { payload, fromContainer, nodeId } of frames) {
    const scriptId = getScriptIdIfRef(payload);
    if (scriptId) {
      const targetKey = entityKeyOf("script", scriptId);
      const via = fromContainer ? `PageNode → ${payload.nodeType}` : payload.nodeType;
      // Materialize the script entity with id-only displayName; `scanAllScripts`
      // enriches displayName with `script.name` (every script is listed there).
      materializeEntity(state, {
        key: targetKey,
        kind: "script",
        id: scriptId,
        displayName: scriptId,
      });
      addEdge(state, fromKey, targetKey, via, nodeId);
    }

    if (payload.nodeType === "InnerTreeEvaluatorNode" && payload.tree) {
      const targetKey = entityKeyOf("journey", payload.tree);
      // Inner journey may not be in our listJourneys result (e.g. a stale
      // ref to a deleted inner tree). Materialize lazily with id-only
      // displayName so the inbound ref still records.
      materializeEntity(state, {
        key: targetKey,
        kind: "journey",
        id: payload.tree,
        displayName: payload.tree,
      });
      const via = fromContainer ? "PageNode → InnerTreeEvaluatorNode" : "InnerTreeEvaluatorNode";
      addEdge(state, fromKey, targetKey, via, nodeId);
    }

    if (payload.nodeType === "PageNode" && payload.themeId) {
      const targetKey = entityKeyOf("theme", payload.themeId);
      materializeEntity(state, {
        key: targetKey,
        kind: "theme",
        id: payload.themeId,
        displayName: payload.themeId,
      });
      addEdge(state, fromKey, targetKey, "PageNode", nodeId);
    }

    if (
      (payload.nodeType === "EmailSuspendNode" || payload.nodeType === "EmailTemplateNode") &&
      payload.emailTemplateName
    ) {
      const targetKey = entityKeyOf("emailTemplate", payload.emailTemplateName);
      materializeEntity(state, {
        key: targetKey,
        kind: "emailTemplate",
        id: payload.emailTemplateName,
        displayName: payload.emailTemplateName,
      });
      addEdge(state, fromKey, targetKey, payload.nodeType, nodeId);
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
        if (!name) continue;
        const targetKey = entityKeyOf("socialIdp", name);
        materializeEntity(state, {
          key: targetKey,
          kind: "socialIdp",
          id: name,
          displayName: name,
        });
        addEdge(state, fromKey, targetKey, idpVia, nodeId);
      }
    }
  }
}

/** Enrich a script entity with its real name + `isLibrary` flag once the
 * body has been fetched. The journey scan materializes scripts id-only;
 * this fills in the human name. */
function enrichScriptEntity(
  state: BuildState,
  fromKey: string,
  scriptId: string,
  script: Script,
): void {
  const isLibrary = script.context === LIBRARY_CONTEXT ? true : undefined;
  const existing = state.entities.get(fromKey);
  if (existing) {
    existing.displayName = script.name;
    if (isLibrary !== undefined) existing.isLibrary = true;
    return;
  }
  materializeEntity(state, {
    key: fromKey,
    kind: "script",
    id: scriptId,
    displayName: script.name,
    ...(isLibrary === undefined ? {} : { isLibrary: true }),
  });
}

async function scanThemes(state: BuildState, journeyByName: Map<string, Journey>): Promise<void> {
  let themes: Awaited<ReturnType<PaicClient["listThemes"]>>;
  try {
    themes = await state.limit.run(() => state.client.listThemes(state.realm));
  } catch (err) {
    state.log.warn(
      {
        event: "realm-index.build.listThemesFailed",
        message: err instanceof Error ? err.message : String(err),
      },
      "listThemes failed — themes will only be present if referenced via PageNode.themeId",
    );
    return;
  }

  for (const theme of themes) {
    const targetKey = entityKeyOf("theme", theme.id);
    materializeEntity(state, {
      key: targetKey,
      kind: "theme",
      id: theme.id,
      displayName: theme.name,
    });
    // Theme.linkedTrees — free reverse-lookup from PAIC. Each linked
    // journey contributes a `linkedTrees` inbound ref.
    for (const journeyId of theme.linkedTrees ?? []) {
      if (!journeyByName.has(journeyId)) {
        // Stale linkedTrees entry — journey may have been deleted. Still
        // materialize a minimal journey entity so the ref doesn't dangle.
        materializeEntity(state, {
          key: entityKeyOf("journey", journeyId),
          kind: "journey",
          id: journeyId,
          displayName: journeyId,
        });
      }
      addEdge(state, entityKeyOf("journey", journeyId), targetKey, "Theme.linkedTrees");
    }
  }

  // Enrich previously materialized themes (those discovered via
  // PageNode.themeId during scanJourney) with their real displayName.
  for (const theme of themes) {
    const existing = state.entities.get(entityKeyOf("theme", theme.id));
    if (existing && existing.displayName === theme.id) {
      existing.displayName = theme.name;
    }
  }
}

async function scanSocialIdps(state: BuildState): Promise<void> {
  let idps: Awaited<ReturnType<PaicClient["listSocialIdps"]>>;
  try {
    idps = await state.limit.run(() => state.client.listSocialIdps(state.realm));
  } catch (err) {
    state.log.warn(
      {
        event: "realm-index.build.listSocialIdpsFailed",
        message: err instanceof Error ? err.message : String(err),
      },
      "listSocialIdps failed — IdPs will only be present if referenced via a journey node",
    );
    return;
  }

  for (const idp of idps) {
    materializeEntity(state, {
      key: entityKeyOf("socialIdp", idp.name),
      kind: "socialIdp",
      id: idp.name,
      displayName: idp.name,
    });
  }
}

/**
 * Enumerate EVERY script in the realm — including ones referenced by no journey
 * — so Search/by-name/Unused cover the whole realm, not just the journey
 * closure (D36 full-index upgrade). `listScripts` returns each body, so the
 * `require()`/esv edge walk runs **in-memory** with no extra HTTP. Best-effort:
 * a failure leaves the journey-referenced index intact.
 */
async function scanAllScripts(state: BuildState): Promise<void> {
  let scripts: Script[];
  try {
    scripts = await state.limit.run(() => state.client.listScripts(state.realm));
  } catch (err) {
    state.log.warn(
      {
        event: "realm-index.build.listScriptsFailed",
        message: err instanceof Error ? err.message : String(err),
      },
      "listScripts failed — index keeps only journey-referenced scripts",
    );
    return;
  }

  // Name → script, for resolving require() against the full set (no HTTP).
  const byName = new Map<string, Script>();
  for (const s of scripts) if (!byName.has(s.name)) byName.set(s.name, s);

  // Determinate progress — the total is known up front (one list call), so the
  // "scripts" phase is a true X / Y like the journey scan.
  let done = 0;
  state.onProgress?.({ phase: "scripts", done: 0, total: scripts.length });
  for (const script of scripts) {
    const fromKey = entityKeyOf("script", script.id);
    // Materialize (or enrich an id-only entity left by the journey scan).
    enrichScriptEntity(state, fromKey, script.id, script);
    if (!state.scriptsById.has(script.id)) state.scriptsById.set(script.id, script);

    // Outbound edges from this script's body. require() resolves against the
    // in-memory set; esv against the tenant ESV index. Edges/entities dedupe,
    // so re-touching a script the journey BFS already walked is harmless.
    const refs = extractScriptBodyRefs(script.body);
    for (const name of refs.libraryScripts) {
      const found = byName.get(name);
      if (!found) continue; // not in the realm — no entity (D36)
      const targetKey = entityKeyOf("script", found.id);
      const isLibrary = found.context === LIBRARY_CONTEXT || !found.context;
      materializeEntity(state, {
        key: targetKey,
        kind: "script",
        id: found.id,
        displayName: found.name,
        ...(isLibrary ? { isLibrary: true } : {}),
      });
      addEdge(state, fromKey, targetKey, "require()");
    }
    for (const name of refs.esvs) {
      const esvKind = state.esvByName.get(name);
      if (!esvKind) continue;
      const targetKey = entityKeyOf("esv", name);
      materializeEntity(state, {
        key: targetKey,
        kind: "esv",
        id: name,
        displayName: name,
        esvKind,
      });
      addEdge(state, fromKey, targetKey, "string literal");
    }
    done++;
    state.onProgress?.({ phase: "scripts", done, total: scripts.length });
  }
}

/**
 * Enumerate EVERY IDM email template (tenant-wide) so unreferenced ones show in
 * Search/Unused. Leaf entities (no outbound refs). Best-effort.
 */
async function scanAllEmailTemplates(state: BuildState): Promise<void> {
  let templates: EmailTemplate[];
  try {
    templates = await state.limit.run(() => state.client.listEmailTemplates());
  } catch (err) {
    state.log.warn(
      {
        event: "realm-index.build.listEmailTemplatesFailed",
        message: err instanceof Error ? err.message : String(err),
      },
      "listEmailTemplates failed — index keeps only journey-referenced templates",
    );
    return;
  }
  for (const t of templates) {
    materializeEntity(state, {
      key: entityKeyOf("emailTemplate", t.name),
      kind: "emailTemplate",
      id: t.name,
      displayName: t.displayName ?? t.name,
    });
  }
}

function materializeEntity(state: BuildState, entity: RealmIndexEntity): void {
  const existing = state.entities.get(entity.key);
  if (existing) return; // first-write wins; enrichment happens in-place via callers
  state.entities.set(entity.key, entity);
}

/**
 * Record one inbound edge `from → to`. Deduped on
 * `fromKey|toKey|fromNodeId` (D37 amendment): two same-`via` journey
 * nodes pointing at the same target are kept as distinct edges because
 * their `fromNodeId` differs. Edges with no node identity (`require()` /
 * `string literal` between two scripts, `Theme.linkedTrees`) fall back to
 * `fromKey|toKey|via` — there is no instance to distinguish, so a repeat
 * of the same `via` is a genuine duplicate and collapses.
 */
function addEdge(
  state: BuildState,
  fromKey: string,
  toKey: string,
  via: string,
  fromNodeId?: string,
): void {
  const edgeKey = fromNodeId ? `${fromKey}|${toKey}|${fromNodeId}` : `${fromKey}|${toKey}|${via}`;
  if (state.edgeKeys.has(edgeKey)) return;
  state.edgeKeys.add(edgeKey);
  const ref: ReverseRef = fromNodeId ? { fromKey, via, fromNodeId } : { fromKey, via };
  const list = state.inboundRefs.get(toKey);
  if (list) list.push(ref);
  else state.inboundRefs.set(toKey, [ref]);
}
