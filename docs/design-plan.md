# Ping AIC Journeys (VS Code Extension) — Design Plan

> Single source of truth for what we're building and why. For current build status, see [progress.md](progress.md). For corrections and patterns to avoid, see [lessons.md](lessons.md).

## Concept

A VS Code extension that turns the question *"what does this AIC journey actually depend on?"* into a first-class artifact. The user connects to one or more AIC tenants, picks a journey, and gets:

1. A **lazy tree view** in the sidebar — pick a connection → pick a realm → pick a journey → expand to see direct dependencies (inner journeys, scripts, themes, ESVs, …) → keep expanding to leaves.
2. A **graph webview** in the editor area — the resolved dependency graph rendered with ReactFlow, with kind-colored nodes, typed edges, and click-to-expand.
3. **Reverse lookups** — given a script or inner journey, which top-level journeys end up calling it (transitively).
4. **Orphan / impact reports** as graph queries (later phases).

Read-only. No pull/push/promote. Service-account auth, multi-tenant, local-only.

## Why this is worth building

See `~/BostonIdentity/poc-journey-export/findings-*.md` for the full audit. Short version:

- **PAIC UI export** is fixed-shape JSON. Not a graph, not analyzable.
- **frodo** has `getTreeDescendents` (full-depth inner-tree walker) and `getLibraryScriptsRecurse` (full-depth library-script walker), but **neither is wired into `journey export`** — so users see only 1-level deps.
- **fr-config-manager** produces a directory tree, narrower deps than frodo, sequential fetch, no graph.
- **aic-pipeline** has the best per-journey viewer of any of them, but it's one journey at a time; no transitive graph, no reverse lookup.

The asset is *the resolved dependency graph as a first-class artifact*. Everything else (tree view, webview, diff, impact analysis) is a thin layer over that.

## Locked decisions

### D1 — Stack

VS Code Extension API + TypeScript + esbuild bundle. No webpack, no Webpack-clones. Webview UI (later) is React + ReactFlow as a separate esbuild entry point.

### D2 — Foundation: raw REST, not frodo-lib or fr-config-manager

Lifted ideas (auth flow, error wrapping, realm-path helper, pagination shape, logger pattern) but no library dependency. See `poc-journey-export/findings-04-subsystems-to-reuse.md`.

Reasons:
- Dependency cost matters in extensions (VSIX size, activation time).
- frodo-lib uses a global `State` singleton and has `process.exit()` in some paths — both unsafe in the Extension Host.
- The HTTP layer is short (~5 endpoint families). The resolver is where the value is.

### D3 — Storage: settings.json + SecretStorage, keyed by `host`

Per-connection: `host`, `saId`, optional `name` in `aicJourneys.connections` (settings.json). `saJwk` in `SecretStorage` keyed by `aicJourneys.saJwk.<host>`. Workspace-if-open else global target. See `poc-journey-export/findings-05-storage-strategy.md`.

### D4 — `host` is the stable identity

Not a synthetic UUID, not a user-given name. Hosts are unique, stable, and human-meaningful. `name` is a pure display label, optional.

### D5 — "Connection" (not "tenant", not "environment")

User-facing vocabulary follows frodo's "connection profile" idea. Matches what the data actually is (a connected session against a host with creds). Avoids the "environment" overload from VS Code's own usage.

### D6 — Read-only

No pull, no push, no promote. If anyone wants those, they use aic-pipeline. We stay focused on analysis.

### D7 — Dependency resolution: full-depth BFS with cycle guard

For each journey:
- Fetch tree skeleton.
- Fetch every node payload referenced in `tree.nodes`.
- Recurse into `PageNode.nodes` children.
- For every `ScriptedDecisionNode.script` → fetch script → recurse into library scripts (depth-N).
- For every `InnerTreeEvaluatorNode` → recurse into that tree (depth-N).
- Track ESV references in script bodies (`&{esv...}` and `systemEnv.X`).
- (Later) themes, email templates, SAML, social IdPs.

Cycle guard via visited-set keyed by `(kind, id)`.

### D8 — In-memory cache per session, no on-disk persistence (yet)

Resolver memoizes by `(kind, id)` within a session. Saved graphs (later) are an explicit user action that writes to `globalStorageUri/cache/<host>/graphs/`.

### D9 — Logging

`vscode.window.createOutputChannel('AIC Journeys', { log: true })`. `LogOutputChannel` so `info/warn/error/debug/trace` levels work and a disk file is written automatically. Production log level is configurable; dev uses Trace.

Never log secrets. Logger redacts keys that look like `saJwk`, `password`, `token`, `secret`.

### D10 — Never `process.exit()`

Anywhere. Throwing is the only way to fail in extension code.

## Data model

```typescript
// Connection — what the user manages
interface Connection {
  host: string;          // identity
  saId: string;
  name?: string;         // display label
}

// saJwk lives in SecretStorage; never crosses into types directly.

// Resolved graph — the output of the resolver
type NodeKind = 'journey' | 'node' | 'script' | 'library-script' | 'esv' | 'theme' | 'email-template' | 'saml-entity' | 'social-idp';
type EdgeKind = 'contains' | 'calls-inner-tree' | 'invokes-script' | 'imports-library' | 'references-esv' | 'uses-theme';

interface GraphNode {
  id: string;            // `${kind}:${stableId}` — composite
  kind: NodeKind;
  label: string;
  raw?: unknown;         // original AIC JSON, for detail pane
}

interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  via?: string;          // node uuid that connects them, for explainability
}

interface DependencyGraph {
  rootId: string;
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
}
```

## Phases

### Phase 0 — POC: connection CRUD ✅

Activity bar + tree view + add/edit/remove. Settings.json + SecretStorage. `LogOutputChannel`. Tail-able log file. **Done.**

### Phase 1 — Foundation: AIC client + auth

- `src/aic/auth.ts` — JWT-bearer mint + cache + invalidate (port from aic-pipeline's `iga-api.ts`, add frodo's scope-fallback idea).
- `src/aic/http.ts` — axios instance per connection, header injection, transaction id, 30s timeout, exponential backoff for transient errors.
- `src/aic/realm-path.ts` — copy frodo's `getRealmPath` verbatim.
- `src/aic/errors.ts` — `AicError` class flattening `AxiosError` fields.
- `src/aic/client.ts` — `AicClient` with five methods: `listJourneys`, `getTree`, `getNode`, `getScript`, `getScriptByName`.
- `src/aic/pagination.ts` — async iterable for `_queryFilter=true` endpoints.
- **Test Connection** command — mints a token, lists realms, shows ✓/✗.

### Phase 2 — Resolver

- `src/resolver/graph.ts` — types.
- `src/resolver/walk.ts` — `walkJourney(client, journeyId)` → `DependencyGraph`. Full-depth, cycle-guarded.
- `src/resolver/cache.ts` — per-session memoization.
- Test against the captured fixtures (`webauth_login_example`, `webauth_register_example`).

### Phase 3 — Tree view: connections → realms → journeys → deps

- Lazy expansion. Each level fetches on demand.
- Empty state, loading state, error state.

### Phase 4 — Graph webview

- React + ReactFlow as a separate esbuild bundle.
- Receives `DependencyGraph` via `postMessage` from extension code.
- Layouts: hierarchical (default), force-directed (toggle).
- Filter chips per `NodeKind`.
- Click a node → detail pane with `raw` JSON.

### Phase 5 — Reverse lookups

- "Who uses this script?" — query the graph index.
- "Who calls this inner journey transitively?" — same.

### Phase 6 — Orphans + impact

- Reachable-from-enabled-top-level-journey reachability.
- "If I change this script, which journeys are affected?" — reverse-reachability query.

### Phase 7 — Saved graphs + diff

- Save a resolved graph to `globalStorageUri/cache/<host>/graphs/`.
- Diff two saved graphs (same tenant at different times, or two tenants).

## Open questions

- **Q1** — Should we cache fetched journey/node/script blobs to disk to survive reloads? Default: no, in-memory only. Reconsider once we have a real workload.
- **Q2** — Do we want to import connections from `paicLogSearch.environments` (the sibling log extension)? Probably yes as an opt-in command; not on by default.
- **Q3** — ESV reference detection: regex over script bodies, or AST? Regex first (`&{esv\.[^}]+}` and `systemEnv\.\w+`); upgrade if false positives appear.

## Non-goals

- No write operations to AIC.
- No alternative auth flows (admin user + 2FA, SSO, basic auth). Service-account JWT-bearer only.
- No support for PingOne, PingFederate, or non-AIC ForgeRock deployments in v1.
- No telemetry, no analytics, no remote sync.
- No "live diff" between editor changes and tenant state.
