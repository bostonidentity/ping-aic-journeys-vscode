# PAIC Journeys — Progress

> Build status tracker. See [design-plan.md](design-plan.md) for what each milestone means and why (open questions live there too).

## M0 — Connection CRUD ✅

- [x] Repo scaffolded
- [x] Manifest with activity bar container, tree view, three commands, settings property
- [x] `Connection` type + add/edit/remove flow
- [x] Plaintext fields → `paicJourneys.connections` setting (workspace-if-open else global)
- [x] `saJwk` → `SecretStorage` keyed by `paicJourneys.saJwk.<host>`
- [x] Tree view with `host`/`name` label
- [x] Inline action buttons (Edit, Remove) on each connection row
- [x] Each connection row is collapsible (folder shape, even with no children yet)
- [x] Non-modal QuickPick confirmation for Remove (matches database extension pattern)
- [x] `LogOutputChannel('PAIC Journeys', { log: true })` wired into all commands
- [x] `dev-tail.sh` to follow the latest disk log file from a terminal (Linux + macOS)
- [x] esbuild build pipeline (`npm run build`, `npm run watch`)
- [x] `src/paic/auth.ts` — `mintToken()` (JWT-bearer, scope fallback, RS256)
- [x] Test Connection button in Add/Edit form (mints token, shows ✓/✗ inline)

## M1 — Forward exploration with detail panel ✅

**Goal:** pick connection → realm → journey → see scripts + inner-trees as children → select anything → see basic info in a detail panel.

### Structured logger (D9)

- [x] Add `pino` runtime dep (in-process `RotatingFileStream`, no `pino-roll`)
- [x] `src/util/logger.ts` — pino instance with `pino.multistream([channelAdapter, fileStream])`, `redact` paths for secrets, `base: { service, version }`, `level` per stream
- [x] Channel adapter: tiny `Writable` that parses NDJSON and routes to `LogOutputChannel.trace/debug/info/warn/error`
- [x] In-process `RotatingFileStream` (sync `openSync`/`writeSync`/`renameSync`); rotates at 5 MB × 5 files; injectable maxBytes/maxFiles for tests
- [x] Settings: `paicJourneys.logging.level`, `paicJourneys.logging.fileEnabled`
- [x] Migrated 17 existing `log.*` calls (12 in `extension.ts`, 5 in `connection-form.ts`) to pino's `log.{level}({fields}, "msg")` shape with `event` field
- [x] 9 unit tests in `tests/util/logger.test.ts`, all green
- [ ] Manual verification of NDJSON output at `globalStorageUri/logs/paic-journeys.ndjson` (do during M1 walkthrough)

### Transport + domain layers

- [x] `src/paic/errors.ts` — `PaicError` flattening AxiosError (`status`, `code`, `errorText`, `description`, `cause`) + `from(unknown)` factory
- [x] `src/paic/realm-path.ts` — `getRealmPath(realm)` verbatim port from frodo, leading-slash convention
- [x] `src/paic/pagination.ts` — `listAllPaged(fetchPage)` canonical do-while over `pagedResultsCookie`
- [x] `src/paic/concurrency.ts` — hand-rolled `mapConcurrent(items, n, fn)` (Q-3 resolved: hand-rolled wins, ~25 lines, zero deps)
- [x] `axios` dependency installed (^1.16.1) for use by `errors.ts` and the upcoming `http.ts`
- [x] 16 new unit tests in `tests/paic/{errors,realm-path,pagination,concurrency}.test.ts`, all green
- [x] `src/paic/http.ts` — `makeHttpClient(opts)` factory: per-connection axios instance with `axios-retry` (network + 5xx + 429 w/ Retry-After), request interceptor (Bearer + X-ForgeRock-TransactionId per-request + Accept-API-Version), response interceptor (structured logging + 401 token refresh + `PaicError.from` wrap)
- [x] 9 unit tests via `axios-mock-adapter` covering header injection, transaction-ID-per-request, 502 retry, 429+Retry-After, 401 refresh, double-401 cap, non-401 error wrap, http.request log, http.error log
- [x] Q-4 (TransactionId scope) resolved: **per-request UUID** — best correlation with tenant audit logs
- [x] Q-5 (429 strategy) resolved: **single axios-retry config with Retry-After-aware retryDelay** — keeps retry policy in one place
- [x] `src/paic/mappers.ts` — `Raw*` interfaces + `mapRealm` / `mapJourney` / `mapNodePayload` / `mapScript` + base64 script-body decode (Q-1 resolved: location is `src/paic/mappers.ts`, co-located with transport)
- [x] `src/paic/client.ts` — `makePaicClient({ http, log })` returning `PaicClient` with `listRealms` / `listJourneys` (paginated) / `getJourney` / `getNode` / `getScript`; correct `Accept-API-Version` per endpoint family; URL-encoding of journey/node/script IDs
- [x] `src/domain/types.ts` — `Connection`, `Realm`, `Journey`, `NodeRef`, `NodePayload` (discriminated union with `"ScriptedDecisionNode" | "InnerTreeEvaluatorNode" | "other"` discriminant), `Script` (Q-2 resolved: folder name is `src/domain/`)
- [x] `extension.ts` imports `Connection` from `@/domain/types` (local interface removed)
- [x] 14 new unit tests in `tests/paic/{mappers,client}.test.ts`, all green
- [x] Conventions doc updated to document AIC wire-protocol field-name exception (leading underscores in `Raw*` types are intentional)

### Tenant registry

- [x] `src/tenants/registry.ts` — `makeTenantsRegistry(deps, log)` with `list/add/update/remove/getJwk` + `onDidChange` event + `Disposable`. Owns the secret prefix; handles the host-rename secret-move case once. `makeProductionDeps(context)` adapter wires VS Code workspace+secrets.
- [x] `src/extension.ts` migrated: registry replaces the 10 inlined persistence touchpoints; `provider.refresh()` now hooks `registry.onDidChange` automatically (drops 3 manual refresh calls).
- [x] `tests/util/vscode-mock.ts` created (minimal `vi.mock("vscode", …)` factory — `MockEventEmitter` + `ConfigurationTarget` + `workspace` + `Disposable`). Per `.claude/rules/testing.md` convention.
- [x] 9 unit tests in `tests/tenants/registry.test.ts`, all green — covers persistence, rename-without-jwk secret move, rename-with-jwk overwrite, remove, getJwk, dispose-after.

### Tree view (deeper levels + D12 cutover)

- [x] `views/nodes/base.ts` — abstract `PaicNode` + `MessageNode` (D12 class hierarchy lands here)
- [x] `views/nodes/connection.ts` — L1; expands to realms
- [x] `views/nodes/realm.ts` — L2; expands to journeys
- [x] `views/nodes/journey.ts` — L3; expands via `journey-expand` shared helper
- [x] `views/nodes/script.ts` — L4 leaf (M3 will widen with library-script recursion)
- [x] `views/nodes/inner-journey.ts` — L4+ recursive with ancestor-visited cycle guard
- [x] `views/nodes/journey-expand.ts` — shared concurrency-capped expansion (cap=10) used by both `JourneyNode` and `InnerJourneyNode`
- [x] `views/paic-tree-provider.ts` — element-driven `TreeDataProvider`
- [x] `tenants/client-cache.ts` — per-host `PaicClient` with in-memory token cache
- [x] `paic/auth.ts` augmented: `MintTokenSuccess.accessToken` (required by client cache)
- [x] `extension.ts` migrated to `PaicTreeProvider` + `ClientCache`; `registry.onDidChange` drops stale clients and reloads the tree
- [x] Lazy `getChildren()` per kind; in-memory child cache; error/empty/cycle states surface as `MessageNode` leaves
- [x] `paicJourneys.refresh` (view title) and `paicJourneys.refreshNode` (inline per-row) commands
- [x] 15 new unit tests in `tests/views/nodes/*.test.ts` + `tests/tenants/client-cache.test.ts`, all green

### Detail panel (D15 trigger — webview framework lands here)

- [x] esbuild second entry → `out/webview.js` (267 KB, IIFE, React 18 + DOM)
- [x] `src/webview/messages.ts` — typed `E2W`/`W2E` discriminated unions + `isE2W`/`isW2E` guards; shared by both sides
- [x] `src/webview/inspector/panel.ts` — extension-side singleton lifecycle owner with CSP-locked HTML, nonce-restricted script, `localResourceRoots: [out/]`
- [x] `src/webview/inspector/ui/` — React panel: `main.tsx` entry + `App.tsx` router + 5 card components
- [x] Tree-selection via `vscode.window.createTreeView` → `onDidChangeSelection` → `panel.show(node)` → `postMessage` → kind-specific card render
- [x] Cards: Connection / Realm / Journey / Script / InnerJourney — metadata only at M1 (script body lands in M2)
- [x] In-panel link navigation: click a referenced script in JourneyCard → `postMessage({type:"navigate"})` → `treeView.reveal()` moves tree selection + inspector re-renders
- [x] VSCode CSS variables only; no component lib
- [x] `parent` linking + `getParent` on `PaicTreeProvider` (required by `treeView.reveal`)
- [x] `paicJourneys.openInspector` command + title-bar `$(preview)` button
- [x] `tsconfig.webview.json` separate config: `jsx:react-jsx`, DOM lib, no Node types; extension tsconfig excludes `src/webview/inspector/ui/**`
- [x] Build pipeline split: `npm run build` → `build:ext` + `build:webview`. Typecheck runs both configs.
- [x] 10 new tests across `tests/webview/{messages,inspector/panel}.test.ts`; mocked `WebviewPanel` + `createTreeView` in `vscode-mock.ts`

### Tests

- [x] Unit tests for `paic/auth.ts` (9 cases — mint, scope-fallback, invalid JWK, network error, non-OK responses, scheme-less host)
- [x] Unit tests for `paic/errors.ts`, `realm-path.ts`, `pagination.ts`, `mappers.ts`, `client.ts`, `http.ts`, `concurrency.ts` (shipped during M1 transport task)
- [x] Component smoke tests for the inspector cards — 15 cases across 5 cards (ConnectionCard / RealmCard / JourneyCard / InnerJourneyCard / ScriptCard) via `@testing-library/react` + happy-dom; per-file env via `// @vitest-environment happy-dom` comment
- [x] vitest + esbuild wired for JSX: `esbuild.jsx: "automatic"`, `include` widened to `**/*.test.{ts,tsx}`; `.tsx` tests routed through `tsconfig.webview.json` for DOM + JSX type-check
- [ ] Captured AIC responses scrubbed and committed under `tests/fixtures/` — deferred. Current tests use inline synthetic-but-realistic payloads; promotion to fixture files waits until we have a clean tenant capture to import.

## M2 — Fill the detail panel: real content ✅

Tech locked: **D17** (script body via `vscode.FileSystemProvider`) and **D18** (journey diagram via ReactFlow + dagre).

### Script body (D17) ✅

- [x] `src/providers/script-fs-provider.ts` — `PaicScriptFileSystemProvider implements vscode.FileSystemProvider` + `parseScriptUri` / `makeScriptUri` helpers + `SCRIPT_URI_SCHEME` const. Resolves `paic-script://<host>/<realm>/<scriptId>.<ext>` → `ClientCache.get(host).getScript(realm, id)`. Read-only enforced: `writeFile` / `delete` / `rename` / `readDirectory` / `createDirectory` all throw `FileSystemError.NoPermissions`. 5 s stat-then-read dedupe cache to avoid the double-fetch on open.
- [x] `extension.ts` wires `workspace.registerFileSystemProvider(SCRIPT_URI_SCHEME, …, { isReadonly: true, isCaseSensitive: true })` and registers a new `paicJourneys.openScriptBody` command (accepts a `ScriptNode` from tree right-click or a plain `{host, realm, scriptId, language?}` from the inspector webview).
- [x] Inspector `ScriptCard`: "Open body in editor" button → `postMessage({ type: "openScriptBody", … })`; `InspectorPanel.onMessage` routes that to the `paicJourneys.openScriptBody` command.
- [x] Tree right-click on `ScriptNode` rows: inline `$(go-to-file)` icon + context-menu entry → same command. `commandPalette` `when: false` hides the command from the palette since it requires args.
- [x] 14 unit tests in `tests/providers/script-fs-provider.test.ts` (URI parsing including sub-realms, `makeScriptUri` for JAVASCRIPT/GROOVY, `readFile`, `stat`, dedupe-cache, every mutating method's `NoPermissions` refusal, missing-script → `FileNotFound`, unavailable-client → `Unavailable`, `watch` no-op).
- [x] `src/providers/` introduced as a new architectural slot for VS Code provider implementations; `.claude/rules/conventions.md` + `CLAUDE.md` updated accordingly.
- [x] `tests/util/vscode-mock.ts` extended with `Uri.parse`, `FileSystemError.{NoPermissions,FileNotFound,Unavailable}`, `FileType`, `FilePermission`, `commands.executeCommand`, `workspace.registerFileSystemProvider`.

### Journey diagram (D18) ✅

- [x] Added `reactflow ^11.11.4` + `dagre ^0.8.5` (deps) + `@types/dagre` (devDep).
- [x] `src/webview/inspector/ui/diagram/layout.ts` — pure dagre auto-layout (TB rankdir, 30/48 node/rank spacing). Drops orphan edges. Flags the entry node.
- [x] `src/webview/inspector/ui/diagram/JourneyDiagram.tsx` — ReactFlow viewport with `Background` + `Controls`, `nodesDraggable={false}`, `fitView`, `hideAttribution`. Memoizes layout; routes `onNodeClick` to either `onOpenBody` (script kind) or `onNavigate` (inner kind).
- [x] One custom node component per AIC kind: `ScriptedDecisionNodeView`, `InnerTreeEvaluatorNodeView`, `OtherNodeView` (handles `PageNode`, `ConfigProviderNode`, etc. via a `prettyKind` formatter — M3 will split into per-kind components).
- [x] `JourneyCard` embeds `<JourneyDiagram>` below the metadata when `deps.nodeIndex` is present; threading host/realm/onNavigate/onOpenBody from `App.tsx`.
- [x] Inner-journey nodes carry their `payloadsByNodeId` (added to `JourneyNode` + `InnerJourneyNode`); `expandJourney` populates the map after `mapConcurrent` resolves so we don't double-fetch. Inspector reads it in `sendJourneyDeps` to build `nodeIndex` for diagram click handling.
- [x] `messages.ts` extended: `NodeInfo` interface + `journeyDeps.nodeIndex` field. `isE2W` guard unchanged (still discriminates by `type`).
- [x] esbuild emits `out/webview.css` from `import "reactflow/dist/style.css"` inside `JourneyDiagram.tsx`; webview HTML loads it via `<link rel="stylesheet">` ahead of our inline shell CSS. CSP `style-src` already allowed `webview.cspSource`.
- [x] Diagram CSS (`.diag-node`, `.entry`, `.script`/`.inner`/`.other`) added to the inline `INSPECTOR_CSS` in `panel.ts`; uses VSCode CSS variables for color and `--vscode-charts-*` for kind-coloring.
- [x] 11 new tests: 5 layout-function unit tests in `tests/webview/inspector/ui/diagram/layout.test.ts`; 5 component tests in `tests/webview/inspector/ui/diagram/journey-diagram.test.tsx` (ReactFlow stubbed via `vi.mock`); 1 JourneyCard test verifying diagram embedding; panel test extended with `nodeIndex` assertion. Total 122 → 133.

### Polish (M2 follow-up)

- [x] InnerJourneyCard diagram — `InnerJourneyNode.ensureJourney()` lazy-fetches + caches the inner journey's full skeleton (shared with tree expansion to dedupe the request). `InspectorPanel.toSelectPayload` is now async and awaits `ensureJourney()` so the diagram has real nodes to render. `InnerJourneyCard.tsx` embeds `<JourneyDiagram>` when both `journey.nodes` and `deps.nodeIndex` are present. Fetch failure falls back to a placeholder + warns.
- [x] Hover tooltips on tree items — every `PaicNode` subclass now sets `this.tooltip = vscode.MarkdownString` with kind-specific structured metadata (host / realm / status / entry-node / ancestor chain / etc.). `isTrusted: false` (no commands), `supportThemeIcons: true` for future icon embedding.
- [x] Tree collapse + selection state persistence — `TreeItem.id` set to `this.uid` on Connection/Realm/Journey/Script nodes. VS Code automatically persists collapse state per-id across reloads. Skipped on `InnerJourneyNode` because the class's domain `id` field (inner-journey AIC id like `PasswordReset`) shadows `TreeItem.id`; trade documented inline.
- [x] "Open in Diff Editor" command (`paicJourneys.diffScriptAcrossConnections`) — right-click a ScriptNode → optional peer-connection QuickPick (auto-picks when there's only one other connection) → `vscode.diff` opens the two `paic-script://` URIs side-by-side. Cross-tenant script diff is the headline use-case; free side-effect of D17.
- [x] Diagram node hover → full schema tooltip — `NodeInfo` extended with `outcomes` / `inputs` / `outputs` / `rawNodeType`; populated by `panel.ts:sendJourneyDeps`; rendered as native browser `title` attribute via the new shared `buildNodeTooltip` helper. Browser tooltip is dependency-free and keyboard-accessible.


## M3 — Wider dependency kinds ⏳

- [ ] Resolver: `require()` extraction → library scripts
- [ ] Resolver: `&{esv...}` and `systemEnv.X` extraction → ESVs (Q-13)
- [ ] Node-type table expands: `ConfigProviderNode`, `ClientScriptNode`, `SocialProviderHandlerNode(V2)`, `PageNode`
- [ ] Theme refs via `PageNode.stage`
- [ ] Tree provider grows new node kinds (theme, ESV, library-script)
- [ ] Detail panel grows kind-specific cards for each new node type
- [ ] Expect first-click latency on journey expansion to grow (more script-body fetches); document acceptable bound

## M4 — RealmIndex background scan ⏳

- [ ] `src/resolver/realm-index.ts` — `buildIndex(client, realm) → RealmIndex` pure logic
- [ ] Wire to realm-expand event in tree provider
- [ ] Indexes all edge kinds from M3 (journey→script, journey→inner, journey→theme, script→library-script, script→ESV)
- [ ] Status indicator while indexing (Q-8)
- [ ] Cancellation policy when realm collapsed mid-scan (Q-9)

## M5 — Query panel (reverse lookups + orphans) ⏳

- [ ] `src/webview/query/` — second React panel (D15 already in place from M1)
- [ ] Tabs: Reverse Lookup / Orphans / Impact (placeholder)
- [ ] "Open Query Panel" command on realm node
- [ ] Index-not-ready state with progress
- [ ] Queries span all edge kinds from M3

## M6 — Realm-wide graph webview ⏳

- [ ] `src/webview/graph/` — third React entry
- [ ] Re-uses ReactFlow already loaded at M2
- [ ] Hierarchical + force-directed layouts toggle
- [ ] Kind-colored nodes, typed edges
- [ ] Filter chips per `NodeKind`

## M7 — Impact analysis + saved graphs + diff ⏳

- [ ] Impact = reverse-reachability over the union of edge kinds
- [ ] "Save Graph" explicit user action → `globalStorageUri/cache/<host>/graphs/<timestamp>.json` (the only on-disk derived data we ever write)
- [ ] Diff two saved graphs

---

## What's working today

**Connections (M0)**
- Activity bar globe icon opens the PAIC Journeys sidebar.
- Add / Edit / Remove Connection commands; round-trip with JWK in SecretStorage.
- Inline Edit + Remove buttons on each connection row; non-modal QuickPick remove confirmation.
- Test Connection button in the Add/Edit form (live JWT-bearer mint + verification, confirmed against sb3).

**Tree (M1)**
- Lazy expansion through L4: connection → realm → journey → script | inner-journey (with recursion + cycle guard).
- One `PaicClient` per host with an in-memory bearer-token cache; cached clients dropped when the registry mutates.
- Inline refresh button on every expandable row + view-title Refresh; per-row error / empty / cycle states surface as `MessageNode` leaves.

**Inspector (M1)**
- Detail panel opens beside the editor on first selection; reused across selections; survives focus shifts (`retainContextWhenHidden`).
- 5 kind-specific cards (Connection / Realm / Journey / Script / InnerJourney) rendering metadata; journey cards list referenced scripts + inner journeys.
- Click a reference in an inspector card → `treeView.reveal()` moves tree selection + the inspector switches to the new card.
- VS Code theming via `--vscode-*` CSS variables; CSP locked down with nonce-restricted script-src.

**Observability**
- Structured NDJSON logs at `<globalStorageUri>/logs/paic-journeys.ndjson` (5 MB × 5 file rotation) + VS Code Output panel via pino multistream.
- Secret-keyword redaction (`saJwk`, `jwk`, `bearer`, `assertion`, `password`, `token`, `secret`, `authorization`).
- `./dev-tail.sh` follows the latest disk log file across EDH reloads.

**Build + test**
- `npm run build` → `out/extension.js` (~703 KB) + `out/webview.js` (~267 KB).
- `npm run typecheck` covers both `tsconfig.json` and `tsconfig.webview.json`.
- 107 unit tests across PAIC transport, tenant registry + client cache, tree nodes, inspector panel + protocol, and React card components.

## What's broken today

(nothing)

## Active blockers

(none)
