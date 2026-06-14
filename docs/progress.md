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
- [x] ~~Non-modal QuickPick confirmation for Remove (matches database extension pattern)~~ — superseded by **D44** (now a native modal, via `confirm()`)
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
- [x] ~~"Open in Diff Editor" command (`paicJourneys.diffScriptAcrossConnections`) — right-click a ScriptNode → optional peer-connection QuickPick → `vscode.diff` opens the two `paic-script://` URIs side-by-side.~~ **REMOVED (2026-06)** — superseded by the cross-env **export / import / compare** feature (D42 / M9); the dedicated cross-tenant script-diff command + its 3 `package.json` entries were deleted to avoid overlapping with the new Compare pillar. (The underlying `paic-script://` FS provider still supports ad-hoc `vscode.diff` if ever needed.)
- [x] Diagram node hover → full schema tooltip — `NodeInfo` extended with `outcomes` / `inputs` / `outputs` / `rawNodeType`; populated by `panel.ts:sendJourneyDeps`; rendered as native browser `title` attribute via the new shared `buildNodeTooltip` helper. Browser tooltip is dependency-free and keyboard-accessible.


## M3 — Wider dependency kinds ⏳ (current)

Tech locked: **D19** (conditional script-ref predicate table) + **D20** (regex script-body parsing, AST upgrade if needed).

### Node-payload widening (journey-level edges)

#### Slice 1 — D19 predicate + script-bearing payload variants ✅

- [x] `src/paic/script-ref-predicates.ts` (new) — `getScriptIdIfRef(payload): string | null`. Exhaustive switch (no `default`) over `NodePayload['nodeType']`; always-script kinds return `scriptId || null`, conditional kinds gate on the flag (`useScript` / `useFilterScript`), other kinds return null. TypeScript exhaustiveness check enforces drift-prevention as the union grows.
- [x] `src/domain/types.ts` — `NodePayload` union extended with 6 new variants: `ClientScriptNodePayload`, `ConfigProviderNodePayload`, `SocialProviderHandlerNodePayload`, `SocialProviderHandlerNodeV2Payload`, `DeviceMatchNodePayload`, `PingOneVerifyCompletionDecisionNodePayload`. Social variants also carry `filteredProviders: string[]`. Conditional variants carry their flag + optional `scriptId` (stale values preserved; predicate gates activation).
- [x] `src/paic/mappers.ts` — `mapNodePayload` extended with branches for all 6 new types. `RawNodePayload` interface gains `useScript`, `useFilterScript`, `filteredProviders` fields.
- [x] `src/views/nodes/journey-expand.ts` — script-discovery branch now calls `getScriptIdIfRef(p)` instead of hard-coding `ScriptedDecisionNode`. Single behavioral change: any of the 7 script-bearing node types now emits a `ScriptNode` child in the tree.
- [x] 15 new tests: 8 in `tests/paic/script-ref-predicates.test.ts` (every branch incl. conditional on/off + null kinds), 6 in `tests/paic/mappers.test.ts` (one per new variant + the V2 missing-field case), 1 in `tests/views/nodes/journey.test.ts` (ClientScriptNode emits a ScriptNode child).

#### Slice 4 — diagram custom-node components + NodeInfo widening + PageNode container walk ✅

- [x] `src/webview/messages.ts` — `NodeInfo.kind` widened to `"script" | "inner" | "theme" | "emailTemplate" | "socialIdp" | "other"`; added optional fields `themeId`, `emailTemplateName`, `socialIdpNames`, `useScript`.
- [x] `src/webview/inspector/ui/diagram/nodes/{PageNode,EmailNode,SocialProviderHandlerNode,SelectIdPNode,DeviceMatchNode,ConfigProviderNode,ClientScriptNode,PingOneVerifyCompletionDecisionNode}View.tsx` — 8 new ReactFlow node components (the catch-all `OtherNodeView` is now reserved for genuinely unknown AIC kinds only).
- [x] `src/webview/inspector/ui/diagram/nodes/tooltip.ts` — `buildNodeTooltip` extended for the 4 new `kind` values + the conditional-kind `useScript=false` decorator + SocialProviderHandler*-style entries (script + IdPs surface both lines).
- [x] `src/webview/inspector/ui/diagram/JourneyDiagram.tsx` — registers all 8 new node types; `rfNodeType()` now uses a `keyof` lookup. `onNodeClick` priority chain: script → inner → theme → emailTemplate → socialIdp.
- [x] `src/webview/inspector/panel.ts` — `sendJourneyDeps` now builds `nodeIndex` via the new `buildNodeInfo` helper (extracted at the bottom of the file). Three new uid-lookup maps (`themeUidById`, `emailUidByName`, `idpUidByName`) populated alongside the existing two; CSS rules added for 8 new view variants (`page`/`email`/`social`/`select-idp`/`device-match`/`config-provider`/`client-script`/`verify`).
- [x] `src/views/nodes/journey-expand.ts` — single-level **PageNode container walk**: after the top-level payload fetch, scan `PageNode.childRefs` and fetch each via `getNode` (concurrency-capped at 10). Merged children's payloads land in `payloadsByNodeId` so nested ScriptedDecisionNodes / InnerTreeEvaluatorNodes surface as journey-level deps. Failures logged + skipped (no throw).
- [x] 24 new test outcomes across 8 component smoke tests, the `tooltip.test.ts` (5 cases), 3 `JourneyDiagram` extensions, 1 panel-test extension, and 2 `journey-expand` container-walk cases. Total 204 → 228.
- [x] `/check fast` + `/check all` green; `npm run build` → `out/webview.js` 851 KB + `out/webview.css` 8.5 KB.
- [x] Lint clean (0 errors, 126 documented warnings — AIC wire-protocol underscore fields + biome `noSecrets` false-positives on AIC node-type name strings + cognitive complexity on the grown payload-mapping switch).

#### Slice 3 — journey-level new leaves (theme / email-template / social-idp) ✅

- [x] `src/paic/mappers.ts` — `PageNode` variant: `childRefs[]` (inline child-node refs preserved) + parsed `stage.themeId` (JSON + legacy `themeId=` forms).
- [x] `src/paic/mappers.ts` — `EmailSuspendNode` / `EmailTemplateNode` variants: `emailTemplateName: string`.
- [x] `src/paic/mappers.ts` — `SelectIdPNode` variant: `filteredProviders: string[]`.
- [x] `src/paic/mappers.ts` — `mapTheme`, `mapEmailTemplate`, `mapSocialIdp`, `mapEsvVariable`, `mapEsvSecret` (with their `Raw*` shapes).
- [x] `src/domain/types.ts` — 4 new payload variants + 4 new resource types (`Theme`, `EmailTemplate`, `SocialIdp`, `Esv = EsvVariable | EsvSecret`).
- [x] `src/paic/client.ts` — `getTheme(realm, themeId)` (IDM `/openidm/config/ui/themerealm` whole-config + client filter), `getEmailTemplate(name)` (IDM `/openidm/config/emailTemplate/<name>`, 404 → null), `listSocialIdps(realm)` (AM `_action=nextdescendents` POST), `getEsv(name)` (variables-then-secrets fall-through).
- [x] `src/views/nodes/{theme,email-template,social-idp}.ts` — three new leaf classes, each with kind-specific icon + tooltip.
- [x] `src/views/nodes/journey-expand.ts` — 3 new emission branches (theme via PageNode.stage, email-template via EmailSuspend/Template, social-idp via SocialProviderHandler*/SelectIdP filteredProviders). All deduped per-realm.
- [x] `src/webview/messages.ts` — `SelectPayload` widened with `theme` / `emailTemplate` / `socialIdp` kinds; `journeyDeps` E2W extended with `themes` / `emailTemplates` / `socialIdps` NodeRef arrays; `NodeRef.kind` union widened.
- [x] `src/webview/inspector/panel.ts` — `toSelectPayload` resolves Theme / EmailTemplate / SocialIdp / Esv resources via the new client methods (graceful name-only fallback on miss); `sendJourneyDeps` emits the new NodeRef arrays.
- [x] `src/webview/inspector/ui/App.tsx` — routes the 3 new card kinds; `JourneyDepsState` widened.
- [x] `src/webview/inspector/ui/cards/ThemeCard.tsx`, `EmailTemplateCard.tsx`, `SocialIdpCard.tsx` (new); `EsvCard.tsx` rewritten to render resolved metadata (variable expression type, secret encoding, description, lastChangeDate).
- [x] `JourneyCard.tsx` deps block refactored — single `DepsSection` helper now emits Scripts / Inner journeys / Themes / Email templates / Social IdPs subsections.
- [x] 30 new test outcomes across 8 mapper + 4 client + 3 journey-expand + 3 leaf-class + 4 card + 1 panel + 7 prior fixture updates. Total 174 → 204.

### New PAIC client methods

- [x] `src/paic/client.ts` — `getEmailTemplate(name) → EmailTemplate | null` (IDM `/openidm/config/emailTemplate/<name>`, 404 → null). Slice 3.
- [x] `src/paic/client.ts` — `getSocialIdp(realm, name) → SocialIdp | null` — thin wrapper around `listSocialIdps` + filter (AIC's direct lookup requires `(type, name)` which our callers don't carry). Slice 4 follow-up.
- [x] `src/paic/client.ts` — `getTheme(realm, themeId) → Theme | null` (IDM `/openidm/config/ui/themerealm` whole-config + client filter). Slice 3.
- [x] `src/paic/client.ts` — `getEsv(name) → Esv | null` (tries `/environment/variables/<name>`, falls back to `/environment/secrets/<name>` on 404). Slice 3.
- [ ] `listEsvs()` for the realm-index — explicitly deferred to **M4** (RealmIndex needs it; inspector cards don't).
- [x] Library scripts reuse `getScript`-shaped fetch — Slice 2 uses `getScriptByName(realm, name)` which returns the full `Script` via `mapScript`, including the base64-decoded body. (`script.context === "LIBRARY"` distinction is informational only — the wire shape is identical to a non-library script.)

### Script-body parsing (script-level edges, D20) ✅ — Slice 2

- [x] `src/util/script-body-parser.ts` — `extractScriptBodyRefs(body): { libraryScripts: string[]; esvs: string[] }`. Single regex set: `require('<name>')` (both quote styles, whitespace-tolerant), `&{esv.<NAME>}`, `systemEnv.<NAME>`. Returns deduped + sorted arrays. 9 unit tests cover every form + the dedup paths. (Originally placed in `src/resolver/`; moved to `src/util/` during M4 Slice 1 because the D21 boundary test caught the pre-existing `src/views/` → `src/resolver/` import.)
- [x] `src/paic/client.ts` — `getScriptByName(realm, name): Promise<Script | null>`. Uses `_queryFilter=name eq "<name>"` against `/am/json/<realmPath>/scripts`. Returns first result mapped via `mapScript`, or null on miss. Frodo's `scriptQueryURLTemplate` shape verbatim.
- [x] `src/views/nodes/script-expand.ts` — shared `expandScript({host, realm, body, selfKey, visited, cache, log, parent})` helper. Resolves `require()` names → UUIDs via concurrency-capped `getScriptByName` (cap=10), emits `LibraryScriptNode` for hits, `MessageNode("[cycle: <name>]")` when the name is in `visited`, `MessageNode("[missing library: <name>]")` for misses. Emits one `EsvNode` per unique ESV reference.
- [x] `src/views/nodes/script.ts` — `ScriptNode` collapsible (Collapsed by default). New `ensureBody()` lazy-fetches + caches the script body (shared in-flight Promise). `loadChildren()` runs `expandScript`. `refresh()` clears the body cache. New `visited?: readonly string[]` parameter, default `[]`.
- [x] `src/views/nodes/library-script.ts` — `LibraryScriptNode` constructed with body in hand (avoids a second `getScript` fetch since `getScriptByName` already returned it). Same `expandScript` recursion + `visited` cycle-guard pattern.
- [x] `src/views/nodes/esv.ts` — `EsvNode` (leaf, name only). Distinct icon (`symbol-variable`) + contextValue (`esv`). M3 polish adds `getEsv` metadata fetch.

### Other new tree-node classes (journey-level deps)

- [x] `src/views/nodes/theme.ts` — `ThemeNode` (leaf, journey-level). Slice 3.
- [x] `src/views/nodes/email-template.ts` — `EmailTemplateNode` (leaf, journey-level). Slice 3.
- [x] `src/views/nodes/social-idp.ts` — `SocialIdpNode` (leaf, journey-level). Slice 3.

### Inspector cards + diagram (partial — Slice 2 ships script-shaped, Slice 3 ships journey-shaped)

- [x] `src/webview/messages.ts` — extended `SelectPayload` with `libraryScript` + `esv` kinds; extended `E2W` with `scriptDeps` message; `NodeRef.kind` widened. `isE2W` guard updated.
- [x] `src/webview/inspector/panel.ts` — `toSelectPayload` handles `LibraryScriptNode` + `EsvNode`. New `sendScriptDeps(node)` mirrors `sendJourneyDeps`. `show()` routes script-shaped selections to it.
- [x] `src/webview/inspector/ui/App.tsx` — second deps state slot (`scriptDeps`) + new card-kind routing.
- [x] `src/webview/inspector/ui/cards/ScriptCard.tsx` — adds optional `deps` + `onNavigate` props; renders the shared `ScriptDepsBlock` (library scripts + ESVs as clickable links). `ScriptDepsBlock` exported for reuse.
- [x] `src/webview/inspector/ui/cards/LibraryScriptCard.tsx` — new card; mirrors `ScriptCard` with the "Library script" badge + same deps block + same Open-body-in-editor action (works against the M2 `paic-script://` URI).
- [x] `src/webview/inspector/ui/cards/EsvCard.tsx` — new card; metadata only at Slice 2 (hint about resolution coming in M3 polish).
- [x] New cards: `ThemeCard`, `EmailTemplateCard`, `SocialIdpCard` — Slice 3.
- [x] Diagram custom-node components replace the `Other` fallback for: `PageNode`, `EmailSuspendNode`/`EmailTemplateNode`, `SocialProviderHandlerNode*`, `SelectIdPNode`, `DeviceMatchNode`, `ConfigProviderNode`, `ClientScriptNode`, `PingOneVerifyCompletionDecisionNode` — Slice 4.
- [x] `panel.ts:sendJourneyDeps` — `nodeIndex` extended with the new kinds (`emailTemplate`, `socialIdp`, `theme`) via the `buildNodeInfo` helper — Slice 4.

#### ESV polish — bug fix shipped + follow-ups queued

Bug fix shipped in commit `b41ad21` (parser was capturing `"getProperty"` as ESV names + the dotted/hyphenated REST id mismatch returned 400). POC against sb3 (1,159 scripts) validated the new approach — see D20 + D22 in design-plan.md.

- [x] **D20 parser fix** — `['"](esv\.X)['"]` string-literal regex; dropped the broken `&{esv.X}` (0 hits in 1,159 scripts) and `systemEnv.X` (435 false-positive method-name captures); requires the `esv.` prefix (226/226 unique sb3 refs match)
- [x] **D22 dotted↔hyphenated translation** — `getEsv()` now translates `esv.x.y` → `esv-x-y` before the URL; canonical display name stays dotted; verified against `esv-kyid-portal-name` (200) vs `esv.kyid.portal.name` (400)
- [x] **Comment stripping** — `stripComments(body)` in `script-body-parser.ts` runs before the regex; removes `/* ... */` blocks + `//` EOL; preserves `://` URLs by lookbehind-via-capture
- [x] **D22 kind pre-labeling on script-expand** — `script-expand.ts` fires `listVariables(realm)` + `listSecrets(realm)` in parallel per expansion; pre-labels each `EsvNode` as `variable` / `secret` / `missing`; tree icons differ by kind. Specifically:
  - [x] `PaicClient.listVariables(realm)` + `listSecrets(realm)` added (paged, mirrors `listJourneys`; tenant-scoped — `realm` accepted for API symmetry); names translated dot↔hyphen at the mapper boundary so consumers see dotted form
  - [x] `EsvNode` widened with `kind?: "variable" | "secret" | "missing"` + optional `resolved?: Esv`; icon switches via `iconFor(kind)`; missing nodes carry a "(not in tenant)" description + `esvMissing` contextValue
  - [x] `panel.ts:toSelectPayload` reads `node.resolved` directly — no per-click fetch
- [x] **Right-click "Open script body" works on LibraryScriptNode too** — extended `package.json`'s `view/item/context` `when` clause for `paicJourneys.openScriptBody` from `viewItem == script` to `viewItem =~ /^(script|libraryScript)$/`. `parseOpenScriptArg` accepts `LibraryScriptNode` instances; language pulled from `arg.resolved?.language`. The inline `$(go-to-file)` icon + context-menu entry now appear on both kinds. Cross-tenant diff (`paicJourneys.diffScriptAcrossConnections`) stays narrower (ScriptNode only — library scripts don't have the same cross-tenant comparison story).
- [x] **D24 amendment — every show-a-card gesture spawns a new tab** — replaces the earlier "reuse one preview panel" rule. Collapses `InspectorPanel` + `DiagramPreviewPanel` into a single `InspectorTab` class (one card per instance, one webview per instance, no reuse). Extension-level factory tracks tabs for dispose. Tree click, card hyperlink click, diagram node click ALL spawn fresh tabs. `navigate` W2E message removed entirely. `uidIndex` / `NodeLookup` plumbing deleted (each tab is one-shot).
- [x] **D24 (initial) card-link consistency — route deps-list hyperlinks through the preview panel** — `JourneyCard` / `InnerJourneyCard` `DepsBlock` and `ScriptCard` / `LibraryScriptCard` `ScriptDepsBlock` now call `onPreview(uid)` instead of `onNavigate(uid)`. Main inspector + tree selection are preserved when clicking deps-list links — same behavior as diagram clicks. `ThemeCard.linkedTrees` stays plain text per the rationale (no global journey-by-id lookup available; that's M5 back-search territory). `App.tsx`'s `navigate` callback removed; `panel.ts:onMessage` `navigate` handler retained as dead code for future "Reveal in tree" right-click affordances.
- [x] **Diagram click → secondary preview panel** — clicking a node on the journey diagram now opens the corresponding card in a separate `WebviewPanel` opened beside the main inspector. **Does NOT replace the main inspector** (which still shows the journey) and **does NOT open the script body file** (the ScriptCard's "Open body in editor" button still works for that). Same UX for all kinds (script / inner / theme / email / socialIdp). Implementation:
  - New `W2E.previewNode` message
  - New `src/webview/inspector/preview-panel.ts` — `DiagramPreviewPanel` class; reuses the same React webview bundle; single panel reused across diagram clicks (no tab clutter); card-internal navigate clicks drill DOWN inside the preview itself
  - Extracted `buildSelectPayload(node, cache, log)` as a free export so both panels share the resolution logic
  - `JourneyDiagram` Props simplified: `onNavigate` + `onOpenBody` + `host`/`realm` removed; replaced by single `onPreview(uid)`
  - `JourneyCard` / `InnerJourneyCard` pass `onPreview` through; "Open body" affordances still exist on the cards themselves, not the diagram
- [x] **D23 card field widening — Journey, InnerJourney, Script** — surfaced raw fields per D23 policy (raw values, skip when undefined):
  - `Journey` domain + `RawJourney` + `mapJourney` widened with `innerTreeOnly`, `noSession`, `mustRun`, `transactionalOnly`
  - `JourneyCard.tsx` — shared `JourneyFlags` helper renders the 4 flags as raw `true`/`false` (skip-when-undefined). Exported for reuse by InnerJourneyCard.
  - `InnerJourneyCard.tsx` — uses `JourneyFlags` + added the missing `identityResource` row
  - `Script` domain + `RawScript` + `mapScript` widened with `context`, `description`, `isDefault` (raw `default`), `evaluatorVersion`, `lastModifiedBy`, `lastModifiedDate`. `description: null` from legacy scripts coerces to `undefined` in the domain.
  - `ScriptCard.tsx` — renders the new fields (Context in a `<code>` block, Default (OOTB) as raw bool, Last modified as ISO-8601)
  - 8 new tests (mapper + card) cover the new fields + the skip-when-undefined behavior. Total 266 → 274.
- [x] **Email template body via FileSystemProvider + richer card** — mirrors the M2 script-body pattern (D17). New `paic-email-template://<host>/<name>/<locale>.html` URI scheme served by `src/providers/email-template-fs-provider.ts`; opens via the new `paicJourneys.openEmailTemplateBody` command with VS Code's HTML language mode for free (syntax highlight / fold / find / copy). `EmailTemplate` domain type widened with `defaultLocale`, `displayName`, `description`, `templateId`, `mimeType`, `styles`, `html`, `advancedEditor`. `EmailTemplateCard` now renders all locales' subjects + an "Open body" button per locale + Disabled badge when applicable. 12 new tests covering mapper, FS provider, and card. Visual preview is **not** in scope — users wanting rendered HTML can install Microsoft's Live Preview extension and paste into a real `.html` file.
- [x] **Theme resolution path fix + ThemeCard widening** — discovered during smoke testing: `getTheme()` was reading the wrong wire path. AIC's `/openidm/config/ui/themerealm` returns `{ realm: { <realmName>: RawTheme[] } }` (singular `realm`, direct array — no `.themes` wrapper). Previous code looked at `realms[<realmName>].themes` and silently returned `null` for every lookup. Fixed `RawThemeRealmConfig` + `client.getTheme()` accordingly. Widened `Theme` domain type with `isDefault`, `linkedTrees` (journey IDs referencing the theme — free reverse-lookup for M5), `primaryColor`, `backgroundColor`, `backgroundImage`, `logo` (localized URL map), `logoAltText`, `journeyLayout`, `fontFamily`. `ThemeCard.tsx` rewritten to render: name in heading, "Default" badge when `isDefault`, color swatches, logo `<img>`, linked-journeys list.
- [x] **D22 EsvCard field expansion** — full REST metadata rendered for variables AND secrets:
  - [x] `EsvVariable` domain type widened with `lastChangedBy?`, `loaded?`, `valueBase64?`; `EsvSecret` widened with `lastChangedBy?`, `loaded?`, `activeVersion?`, `loadedVersion?`, `useInPlaceholders?`
  - [x] Mappers + `Raw*` shapes thread the new fields through
  - [x] `EsvCard.tsx` rewritten — kind-discriminated rendering (`VariableFields` / `SecretFields` / `SharedAuditFields`); `decodeEsvValue` UTF-8 round-trip via `atob` + `TextDecoder`; Copy button uses `navigator.clipboard.writeText`
- [x] **D25 hide PAIC root realm** — wire identifier is `parentPath === null` (or absent), not the name (varies by deployment: `"/"`, `"root"`, `"Top Level Realm"`). Added `isRoot: boolean` to the `Realm` domain type, set by `mapRealm` via `raw.parentPath == null`. `ConnectionNode.loadChildren` filters `!r.isRoot && r.name !== "/"` (belt-and-suspenders against name variants). Filter lives in view layer; data layer stays a faithful translation per D11. If on-prem AM support is added later, the filter becomes conditional on `connection.type`. 5 new tests (2 mapRealm wire shapes + 3 connection-filter variants). Total 274 → 278.

#### Diagram + theming polish (D26 + D27 + D28)

- [x] **D26 diagram direction → LR** — `layout.ts` flipped `rankdir: "TB"` → `"LR"`; bumped `ranksep: 48` → `70`. Also flipped Handle positions from `Top`/`Bottom` → `Left`/`Right` across all 11 existing node views so edges route into the sides of nodes (consistent with LR).
- [x] **D26 enable node dragging (non-persistent)** — `JourneyDiagram.tsx` migrated from `useMemo`-derived `rfNodes` to `useNodesState` + `nodesDraggable={true}`. Initial nodes re-seed via `useEffect` keyed on `journey.id`. Drag positions live for the inspector tab's lifetime; no persistence layer.
- [x] **D27 theme audit pass** — `panel.ts` `INSPECTOR_CSS`:
  - `.diag-node` background → `var(--vscode-editorWidget-background, var(--vscode-editor-background))` (fixes dark-on-dark)
  - Border widened `1px` → `1.5px`; per-kind stripe `3px` → `5px`
  - New `.diag-node.entry` rule: subtle `outline: 1.5px solid var(--vscode-focusBorder); outline-offset: -1px`
  - ReactFlow defaults overridden: `.react-flow__edge-path`/`__connection-path` stroke, `__edge-textbg`, `__edge-text`, `__background-pattern`, `__controls`, `__controls-button` (+ hover + svg)
  - `:focus-visible` rings on `button.link`, `.card-actions button`, `.diag-node`
  - Grep audit confirmed: every hex appears only as a `var(..., #fallback)` per D27
- [x] **D28 synthesize all three platform terminals (Start, Success, Failure)** — `layout.ts` exports `START_NODE_ID = "startNode"`, `SUCCESS_NODE_ID = "70e691a5-1e33-4ac3-a356-e7b6d60d92e0"`, `FAILURE_NODE_ID = "e301438c-0bd0-429c-ab0c-66126501069a"`. Start is always synthesized when `journey.nodes[entryNodeId]` exists, with an implicit `start→entry` edge. Success/Failure are synthesized on demand when referenced from a real node's `connections`. Pinning not needed — LR + dagre's `network-simplex` ranker naturally puts Start (no inbound) leftmost and Success/Failure (no outbound) rightmost.
- [x] **D28 StartNodeView + SuccessNodeView + FailureNodeView** — three non-clickable components under `src/webview/inspector/ui/diagram/nodes/`. Blue/green/red kind stripes via VS Code chart vars. Start has only a source handle (right); Success/Failure have only a target handle (left). Registered in `JourneyDiagram.nodeTypes`. Click handler's existing `if (info?.uid)` guard already no-ops for all three (no `nodeIndex` entry).
- [x] **D28 terminals anchored to vertical midpoint** — `computeLayout` recomputes `(min_y + max_y) / 2` of real journey nodes after dagre runs, then overrides each terminal's `y` to that value (consistent vertical center across simple/complex journeys).
- [x] **Only Start is undraggable** — Success/Failure carry the same draggability as real nodes (the user may want to rearrange terminal labels for readability). `NON_DRAGGABLE = Set([START_NODE_ID])` in `JourneyDiagram`.
- [x] **Reserve blue/green/red for terminals only** — earlier `social`/`select-idp` used red and `inner`/`device-match` used blue and `verify` used green, conflicting with Start (blue)/Success (green)/Failure (red). Reassigned: `inner` + `device-match` → cyan (`--vscode-terminal-ansiCyan`); `social` + `select-idp` + `verify` → magenta (`--vscode-terminal-ansiMagenta`). Per-kind palette is now: purple (scripts), orange (Page), yellow (Email), cyan (Inner/Device), magenta (Social/IdP/Verify), gray (Other). Terminals own blue/green/red exclusively.
- [x] **Removed `.diag-node.entry` outline** — redundant now that Start is a dedicated visual terminal. `isEntry` still drives the hover-tooltip "(entry)" suffix in `buildNodeTooltip`.
- [x] **D28 tests** — `layout.test.ts` +6 cases (Start always synthesized; Start NOT synthesized when entryNodeId missing; Success-only; Failure-only; both outputs; outputs not synthesized when unreferenced) + adjusted existing tests for the +1 node-count math. `journey-diagram.test.tsx` +2 (SuccessNode rf-type wiring, terminal click is a no-op). 3 new view tests (start/success/failure). Total 278 → 289.
- [x] **Lesson recorded** — `docs/lessons.md` 2026-05-18 entry: failure-UUID-from-memory bug + missing Start node both caught by user's `aaron_test_login` smoke test. Verify platform-constant IDs against captured fixtures before adding to source.
- [x] **D29 diagram expand-to-tab-width toggle** — `JourneyDiagram` adds a `ControlButton` as the **4th icon button** in ReactFlow's `Controls` panel (after zoom-in / zoom-out / fit-view), with the whole panel moved to **top-left** (`position="top-left"`). Inline SVG uses horizontal double-arrows (out = expand, in = collapse) — visually distinct from fit-view's frame icon and signals the "width-focused" nature of the toggle. Toggling switches the section between `360px` fixed height inside the card's `720px` cap and `aspect-ratio: 16/9` of full tab width via `:has(.diagram.expanded) { max-width: none }` on the parent card. Height is derived from width (ratio), not from `100vh`, since the webview is already vertically scrollable. Not fullscreen, not persisted. ReactFlow re-fits on toggle via captured instance + `fitView({ padding: 0.12 })` inside a `requestAnimationFrame`. +1 toggle test. Reactflow test mock updated (3 files) to render `ReactFlow` children + provide `Controls` + `ControlButton`. Total 289 → 290.

#### D26/D27/D28 still to verify manually

- [ ] **D27 acid-test** — smoke against Default High Contrast Dark theme (`Ctrl+K Ctrl+T`) before claiming visual done. If it reads correctly there, every theme works.
- [ ] **Live-tenant smoke** in EDH per the plan's verification list (LR direction, drag, terminals, drag-survives-render, theme switch).

#### D30 — Per-outcome handles inside decision nodes (TRIED, REVERTED 2026-05-19)

Implementation worked technically (297/297 tests passing, lint clean, build clean) but the visual result looked cluttered at our current node dimensions — inline-label stack + color stripe + header text + synthesized terminals were busier than the labels-on-edges baseline. User reviewed and reverted. Notes in D30 of `design-plan.md`. All D30 code + tests deleted; layout / JourneyDiagram / 11 node views / CSS restored to the post-D29 state. Total reverted from 297 → 290.

#### D31 — Use server-provided node coordinates instead of dagre auto-layout

- [x] **Domain widening** — `NodeRef` gains `x?: number` and `y?: number`. `Journey` gains `staticNodes?: Record<string, { x: number; y: number }>`.
- [x] **Wire types + mapper** — `RawJourney.staticNodes` typed; `mapJourney` threads node `x`/`y` onto each domain `NodeRef` and maps `raw.staticNodes` verbatim (defaults missing axes to `0`).
- [x] **layout.ts — server-coords primary, dagre fallback** — new `computeLayout` is a small dispatcher routing to `computeServerCoordLayout` (when `hasUsableServerCoords` is true) or the renamed `computeDagreLayout` (existing logic, unchanged behavior). Shared helpers `gatherReferencedOutputTerminals` + `buildEdges` extracted to avoid duplication. Server-coords path subtracts `NODE_W/2` / `NODE_H/2` to convert AIC's center-anchored pixels to ReactFlow's top-left; references `journey.staticNodes` for terminal positions with a "rightmost + center" fallback for terminals that are referenced but missing from `staticNodes`. Terminal vertical-midpoint anchoring (D28) stays in the dagre path only.
- [x] **JourneyDiagram.tsx** — no changes (layout output shape unchanged).
- [x] **Tests**:
  - `mappers.test.ts` +3: preserves node coordinates; maps staticNodes verbatim with `0` defaults; leaves staticNodes undefined when wire omits it.
  - `layout.test.ts` +3: server-coords path uses node x/y verbatim; server-coords path uses `staticNodes` for terminals; falls back to dagre when no node has non-zero coords.
  - Existing tests unchanged — the `journey()` factory doesn't supply coords by default, so all 290 existing tests continue to verify the dagre fallback. Total 290 → 296.

#### D32 — "Re-layout with dagre" Controls button

- [x] **`computeDagreLayout` exported** from `layout.ts` (was a private helper; same body, no behavior change).
- [x] **`toRfNode(n, nodeIndex)` extracted** as a module-level helper — the initial `useMemo` and the new `relayoutWithDagre` handler use the same transformation.
- [x] **5th `<ControlButton>` in `JourneyDiagram`** — small inline SVG icon that swaps with state: tree-graph (3 dots + 2 branches) for "Re-layout", counter-clockwise circular arrow for "Original layout". Plain-text labels live in the `title` (hover tooltip) + `aria-label` attributes.
- [x] **`toggleLayout` handler (D32 is a 2-state toggle)** — `usingDagre` boolean state. Click flips state, calls `computeDagreLayout(journey)` entering dagre mode or `computeLayout(journey)` returning to AIC's layout (D31 dispatcher), then `setRfNodes(layout.nodes.map(toRfNode))` + `requestAnimationFrame → fitView({ padding: 0.12 })`. Drag positions are discarded on toggle in both directions.
- [x] **Expand button uses icon + tooltip** — same pattern: horizontal-arrows-outward → expand, inward → collapse; plain text in `title` + `aria-label`.
- [x] **+1 test in `journey-diagram.test.tsx`** — seeds journey with server coordinates, asserts initial position is server-coords-derived, clicks the Re-layout button (queried by aria-label) → asserts position changes to dagre output, clicks again → asserts position returns to server coords. Mock extended with `data-rf-x`/`data-rf-y` attributes. Total 296 → 297.

#### D33 — Sidebar tree: kind-grouped children + category headers + alphabetical sort

- [x] **`CategoryHeaderNode` class** — `src/views/nodes/category-header.ts`. Extends `PaicNode`. `label = "── <Category> ──"`; `collapsibleState: None`; `contextValue: "categoryHeader"`; no icon, no tooltip, no children.
- [x] **`groupAndSort(nodes)` helper** — `src/views/nodes/grouping.ts`. Exports `kindOf(node)` + `groupAndSort(nodes)`. Classifies by `instanceof` (InnerJourney / Script / LibraryScript / Theme / EmailTemplate / SocialIdp / Esv). Sorts case-insensitively within kind via `localeCompare(..., { sensitivity: "base" })`. Inserts `CategoryHeaderNode` only when ≥2 kinds are present. Unknown nodes (MessageNode etc.) appended at the end in original order.
- [x] **`journey-expand.ts` + `script-expand.ts` wired** — return `groupAndSort(children)` at the end instead of raw `children`. Empty-list `MessageNode` short-circuit kept for clarity.
- [x] **`extension.ts` selection guard** — `treeView.onDidChangeSelection` now skips `CategoryHeaderNode` AND `MessageNode` before calling `inspectorFactory.spawn(node)`. Defensive bonus on `MessageNode`: clicking error / cycle / empty-state rows no longer spawns a vacant inspector tab.
- [x] **Tests** — new `grouping.test.ts` (6 cases: empty, single-kind no header, multi-kind headers in priority order, case-insensitive sort, unknown-kind appended) + `kindOf` smoke (2 cases for known/unknown classification). Existing `journey.test.ts` + `script.test.ts` length assertions updated to filter out `CategoryHeaderNode` before counting data kids. Total 297 → 304.
- [x] **Single-kind levels also sorted** — `RealmNode → JourneyNode` sorts journeys by `id` case-insensitive; `ConnectionNode → RealmNode` sorts realms by `name`. No category headers (single kind), just alphabetical order. +2 tests (realm sorts journeys, connection sorts realms). Total 304 → 306.

#### D34 — Migrate connection form to a separate React bundle

- [x] **New `src/webview/connection-form/`** directory mirrors the inspector layout:
  - `messages.ts` — typed `W2E` (save / cancel / validate) + `E2W` (validateResult ok/err) + `ConnectionFormData` / `ConnectionFormInitial` / `ConnectionFormPayload` types + `isW2E` guard.
  - `panel.ts` — extension-side `openConnectionForm(context, opts) → Promise<ConnectionFormData \| undefined>`; creates the WebviewPanel; embeds initial payload via `data-paic-payload`; wires `onDidReceiveMessage`; includes `handleValidate` (moved from the old file, unchanged); inlines `CONNECTION_FORM_CSS`.
  - `ui/main.tsx` — React entry. Reads payload from `data-paic-payload`; mounts `<App>`. Uses a local cast of `window.acquireVsCodeApi()` because the inspector's `main.tsx` already declares a global with a conflicting `W2E` type — each bundle now casts locally.
  - `ui/App.tsx` — form component. State (name/host/saId/jwk/errors), validation (required fields, duplicate host with Edit-same-host exception, JWK JSON validity, JWK required-in-Add / optional-in-Edit), Test Connection handler with monotonic requestId in a `useRef` (avoids stale-closure on the message listener).
- [x] **New esbuild target** — `package.json` adds `build:connection-form` + `watch:connection-form`; parent `build` chains all three (ext + webview + connection-form). Output: `out/connection-form.js` (262 KB).
- [x] **Deleted `src/views/connection-form.ts`** — old 467-line raw-HTML implementation removed.
- [x] **Updated `src/extension.ts`** — one import line moved to `./webview/connection-form/panel`. No behavioral changes; same external API.
- [x] **`localResourceRoots`** narrowed to `out/` so the bundle loads. CSP unchanged (`default-src 'none'; style-src ... 'unsafe-inline'; script-src 'nonce-…'`).
- [x] **Both tsconfigs updated** — main `tsconfig.json` excludes the new `src/webview/connection-form/ui/**`; `tsconfig.webview.json` includes `tests/webview/connection-form/ui/**` so test files get JSX + DOM lib.
- [x] **Tests** — new `tests/webview/connection-form/ui/app.test.tsx` (6 cases: required-field errors; duplicate-host in Add; Edit-same-host allowed; Edit JWK optional; Test Connection success roundtrip; stale-requestId ignored). Total 306 → 312.

#### Other M3 notes / non-goals

- [ ] First-click latency on journey expansion grows (PageNode container walk adds one extra `getNode` per child ref). Needs a live-tenant measurement pass against sb3 to record the actual range — not blocking the M3 commit; will be recorded here once captured.
- **Deferred** to a later milestone: `product-Saml2Node` (SAML2 entities + circles of trust — narrower customer segment, needs two-fetch resolution); `designer-*` custom marketplace nodes (minority of customers).
- **Deferred to M4** per D21: `listEsvs()` for the realm-index scan stays out of the tree's per-expansion path; the RealmIndex owns its own ESV index with its own refresh cycle. M5 back-search will consume that index, not the tree's per-expansion data.

## M4 — Resolver cache + inspector dependency view ✅

> Per D35 + D21. Per-root cache for forward transitive dep resolution; isolated from the lazy-tree cache and the realm index (D36) — enforced by the boundary test in D21.

### Slice 1 — Resolver data layer + D21 boundary test ✅

- [x] `src/domain/resolved-graph.ts` — wire-shape types (`ResolvedNode`, `ResolvedEdge`, `ResolvedGraph`, `ResolvedNodeKind`, `RootDescriptor`, `RootKind`) + `keyOf` helper. Lives in `domain/` (not `resolver/`) so the webview message protocol can import these in later slices without violating the D21 webview→resolver boundary.
- [x] `src/resolver/walk.ts` — `walkRoot(deps, root): Promise<ResolvedGraph>`. BFS over the root's transitive dep tree, concurrency-bounded via `mapConcurrent` (cap 10). Covers every dep kind the M3 lazy walker produces: script (incl. all D19 conditional kinds), inner-journey, library-script via `require()`, ESV via `extractScriptBodyRefs`, theme via `PageNode.themeId`, email-template via `EmailSuspendNode`/`EmailTemplateNode`, social-IdP via `filteredProviders`. Single-level PageNode container walk matches the lazy tree's behavior.
- [x] Collapsed `ResolvedNodeKind` so that journeys and inner-journeys both map to kind `"journey"` (same AIC entity; only the entry point differs — required for J → IJ → J cycle detection) and scripts and library-scripts both map to kind `"script"`. `RootKind` preserves the user-facing entry distinction.
- [x] **Architectural cleanup:** moved `script-body-parser.ts` from `src/resolver/` to `src/util/` (it's a pure parser with no resolver-cache coupling — the new D21 boundary test caught the pre-existing `src/views/nodes/script-expand.ts` → `src/resolver/` import this caused).
- [x] `tests/resolver/walk.test.ts` — 12 cases against `makeFakePaicClient`: empty journey, one-script child, inner-journey recursion (depth chain), J→IJ→J cycle (back-edge marked `cycle: true`, no re-walk), PageNode container walk (composite `via`), theme via PageNode, script-root with `require()` + ESV literal, library-script recursion (A→B→C), same-layer dup (one node, one non-cycle edge), D19 conditional predicate (DeviceMatchNode `useScript` on/off), email + social-idp + multi-script combo, `durationMs` is finite non-negative.
- [x] `tests/architecture/layer-boundaries.test.ts` — D21 import-boundary enforcement (4 rules: realm-index / resolver / views / webview). Regex matches `@/` aliased and any-depth relative imports. Guards missing dirs (`src/realm-index/` not existing yet trivially passes).
- [x] `tests/util/script-body-parser.test.ts` — relocated alongside the moved source file.

**Verification (Slice 1):** lint 0 errors / 154 warnings (+2 baseline-style complexity warnings on the new walker, matching `journey-expand.ts` + `script-expand.ts`); typecheck clean across both tsconfigs; tests 312 → **328** (+16 new outcomes: 12 walk + 4 boundary); all three bundles emit (`out/extension.js` + `out/webview.js` + `out/connection-form.js`).

### Slice 2 — Resolver cache + sidebar refresh wiring ✅

- [x] `src/resolver/cache.ts` — `makeResolverCache(deps)` factory + `ResolverCache` interface. Keyed by `{host, realm, kind, id}`; in-flight dedup via a parallel `inFlight: Map<string, Promise<ResolvedGraph>>`. API: `resolve(key, walkDeps)`, `dropOne(key)`, `dropAllForHost(host)`, `dispose()`. Walker injected via `deps.walk` (defaults to `walkRoot`) so the cache is unit-testable in isolation. Walker errors are NOT cached — the `finally` clears `inFlight` whether the walk resolves or rejects.
- [x] **D21-compliant invalidation pattern.** Per the boundary test from Slice 1, `src/resolver/cache.ts` cannot import `TenantsRegistry`. Per-host invalidation is wired from `src/extension.ts` (the one site that imports both layers) — the cache exposes `dropAllForHost(host)` and the extension calls it on `registry.onDidChange` for each prior host. Mirrors exactly how `clientCache.drop(h)` is invalidated today.
- [x] `src/extension.ts` — four small wiring edits next to existing `clientCache` touchpoints:
  - Construct `resolverCache = makeResolverCache({ log })` after `clientCache`; push `dispose` onto `context.subscriptions`.
  - `registry.onDidChange` handler: also `resolverCache.dropAllForHost(h)` for each prior host.
  - `paicJourneys.refresh` command: also `resolverCache.dropAllForHost(h)` for each prior host.
  - `paicJourneys.refreshNode` command: `resolverCache.dropAllForHost(node.host)` when the node carries a `host` field (defensive `"host" in node` + typeof check rather than `instanceof` per-class checks).
- [x] `tests/resolver/cache.test.ts` — 10 cases against a stub walker (`vi.fn`): miss-walks-and-stores, hit-returns-cached, in-flight dedup of concurrent calls, `dropOne`, `dropAllForHost` evicts target host, `dropAllForHost` preserves other hosts, `dispose` clears all, walker errors not cached (retry), key isolation across `kind` (journey vs script with same id), `dispose` is a callable Disposable.

**Verification (Slice 2):** lint 0 errors / 154 warnings (no new warnings); typecheck clean; tests 328 → **338** (+10 new outcomes); build emits all three bundles cleanly.

### Slice 3 — Protocol additions + JourneyCard segmented control ✅

- [x] **Protocol additions** in `src/webview/messages.ts`:
  - W2E: `{ type: "resolveFull" }` — the tab derives the root identity from its node, so no payload is needed.
  - E2W: `{ type: "resolveResult"; ok: true; graph: ResolvedGraph } | { type: "resolveResult"; ok: false; message: string }`.
  - `isW2E` / `isE2W` guards updated.
- [x] **Panel handler** in `src/webview/inspector/panel.ts`:
  - `InspectorFactoryDeps` + `InspectorTabDeps` carry `resolverCache: ResolverCache`.
  - `InspectorTab` stashes the constructor `node` as a class field.
  - `handleResolveFull()` uses a new `nodeToResolverKey(node)` helper that maps each of the 4 root-capable PaicNode subclasses (`JourneyNode` → kind+`journey.id`, `InnerJourneyNode` → kind+`id`, `ScriptNode` / `LibraryScriptNode` → kind+`scriptId`) to a `ResolverKey`. Unsupported kinds (`Connection`, `Realm`, `Esv`, `Theme`, `EmailTemplate`, `SocialIdp`) silently no-op.
  - Calls `cache.get(host)` → `resolverCache.resolve(key, { client, log })` → posts `resolveResult` (ok or err).
- [x] **Wiring** — `src/extension.ts` passes `resolverCache` to `new InspectorFactory({ ... })`.
- [x] **App.tsx state slot** — `resolveState: ResolveState` (idle / loading / ok / err). Reset on `select` E2W. `onResolve()` callback posts `resolveFull` W2E. Passed to `JourneyCard` as `resolved` + `onResolve` props.
- [x] **New shared component** `src/webview/inspector/ui/cards/ResolvedView.tsx`:
  - `ResolvedView({ directContent, resolved, onResolve, onPreview })` — section wrapper with header (h2 + summary + segmented control) and conditional body.
  - Inline `SegmentedControl` (Direct / Full tree / Flat) with `role="radiogroup"` + `role="radio"` buttons (the standard segmented idiom; `// biome-ignore lint/a11y/useSemanticElements`).
  - `ResolvedTree` — recursive `<ul>` from root. `(dup)` marker for `edge.cycle === true` (does NOT recurse). Loading/error/empty states.
  - `ResolvedFlat` — sorted unique non-root nodes with ref-count + shortest depth. Empty state.
  - `ResolvedFooter` — `Cycles: N · Depth: M · Resolved in T ms`.
  - `labelFor(kind)` translates `ResolvedNodeKind` → display label.
- [x] **JourneyCard wires `ResolvedView`** — `<DepsBlock>` is now wrapped: the segmented control sits above the existing direct-deps rendering; Full/Flat modes delegate to `ResolvedView` internals.
- [x] **CSS additions** in `INSPECTOR_CSS` (`src/webview/inspector/panel.ts`):
  - `.deps-section-header` (flex row), `.deps-summary`, `.deps-segment-control[.active]`, `.deps-tree[-list,-row,-dup]`, `.deps-flat[-row,-meta]`, `.deps-kind`, `.deps-resolve-loading[-error,-footer]`. All use VS Code semantic vars per D27.
- [x] **D21 boundary-test refinement** in `tests/architecture/layer-boundaries.test.ts`:
  - Dropped the broad `src/webview` rule (which would have forbidden panel.ts from importing the resolver).
  - Added narrower rules for `src/webview/inspector/ui` and `src/webview/connection-form/ui` (the React runtime sandboxes) that forbid `resolver | realm-index | tenants | paic` imports.
  - The spirit of D21 is preserved: runtime UI files stay cache-free; extension-side panel files are the wiring shim.
- [x] **Test setup additions**:
  - `makeFakeResolverCache(opts)` factory in `tests/views/fakes.ts` — supports per-key canned graphs + a `rejectWith` mode for the error-path test.
  - All existing `new InspectorFactory({...})` calls in `tests/webview/inspector/panel.test.ts` updated to pass `resolverCache`.
- [x] **New tests** — total 338 → 356 (+18):
  - `tests/webview/messages.test.ts` — extended `isW2E` / `isE2W` cases for the new message types.
  - `tests/webview/inspector/panel.test.ts` — 3 cases for `resolveFull` (ok roundtrip, err roundtrip, unsupported-kind no-op).
  - `tests/webview/inspector/ui/cards/resolved-view.test.tsx` — 12 cases (segmented control rendering, default mode, click-fires-onResolve, click-skips-onResolve-when-ok, summary visibility, loading/err states, tree rendering, `(dup)` cycle marker, click-to-preview, flat sorting + ref counts, flat empty state).
  - `tests/webview/inspector/ui/cards/journey-card.test.tsx` — 3 cases for the segmented control + existing tests updated to pass `resolved`/`onResolve` props.
- [x] **`docs/design-plan.md` D21** — the "Import-direction rule" subsection (mechanism 2) now splits webview into `<surface>/ui/*` (UI sandbox — strictly cache-free) and `<surface>/panel.ts` files (extension-side wiring shim — allowed to import any layer).

**Verification (Slice 3):** lint 0 errors / 154 warnings (no new warnings); typecheck clean across both tsconfigs; tests 338 → **356** (+18 new outcomes); build emits all three bundles cleanly.

### Slice 4 — Extend segmented control to InnerJourneyCard / ScriptCard / LibraryScriptCard ✅

- [x] **`src/webview/inspector/ui/cards/InnerJourneyCard.tsx`** — added `resolved: ResolveState` + `onResolve: () => void` props; wrapped `<DepsBlock>` in `<ResolvedView>` below the journey diagram.
- [x] **`src/webview/inspector/ui/cards/ScriptCard.tsx`** — added `resolved: ResolveState` + `onResolve: () => void` props; wrapped `<ScriptDepsBlock>` in `<ResolvedView>`. `onPreview` stays optional on the card; `ResolvedView`'s required `onPreview` is satisfied with a module-scope `noopPreview` fallback (defensive — App.tsx always passes a real `previewNode`).
- [x] **`src/webview/inspector/ui/cards/LibraryScriptCard.tsx`** — same pattern as ScriptCard.
- [x] **`src/webview/inspector/ui/App.tsx`** — kind-switch router now passes `resolved={resolveState}` + `onResolve={onResolve}` to InnerJourneyCard / ScriptCard / LibraryScriptCard (JourneyCard already had them from Slice 3). No new state — Slice 3's `resolveState` slot serves all four cards; the panel-side `nodeToResolverKey` already maps each PaicNode subclass to the correct `RootKind`.
- [x] **`tests/webview/inspector/ui/cards/inner-journey-card.test.tsx`** — existing tests' render calls updated to pass `resolved={idle}` + `onResolve={noop}`. 2 new segmented-control cases (renders Direct/Full/Flat radios; clicking Full tree fires `onResolve` when idle).
- [x] **`tests/webview/inspector/ui/cards/script-card.test.tsx`** — same prop updates. 2 new cases (segmented control present; switching to Full with `status: "ok"` renders the resolved tree with the linked entity's displayName + duration footer).
- [x] **`tests/webview/inspector/ui/cards/library-script-card.test.tsx`** — same pattern as inner-journey (2 new cases: segmented control present; clicking Full fires `onResolve`).

**Verification (Slice 4):** lint 0 errors / 156 warnings (+2 baseline-style warnings from the `noopPreview` `const`s in Script/LibraryScript cards); typecheck clean across both tsconfigs; tests 356 → **362** (+6 new outcomes); build emits all three bundles cleanly. After Slice 4, every card kind with a forward-dep walk (Journey / InnerJourney / Script / LibraryScript) shows the segmented control end-to-end.

### Slice 5 — Per-card refresh button + `refreshResolved` protocol ✅

- [x] **Protocol addition** in `src/webview/messages.ts` — added `{ type: "refreshResolved" }` to W2E (no payload; the tab derives the root from its node identically to `resolveFull`). `isW2E` guard extended.
- [x] **Panel handler refactor** in `src/webview/inspector/panel.ts`:
  - `handleResolveFull(forceRefresh: boolean)` — when true, calls `resolverCache.dropOne(key)` (Slice 2 API) before re-resolving. Single code path; one extra log line for the drop.
  - `onMessage` routes `resolveFull` → `handleResolveFull(false)` and `refreshResolved` → `handleResolveFull(true)`.
- [x] **`ResolvedView` refresh button** in `src/webview/inspector/ui/cards/ResolvedView.tsx`:
  - Added `onRefresh: () => void` to `ResolvedViewProps`.
  - Renders `<button class="deps-refresh">↻</button>` inside `.deps-section-header` after the segmented control.
  - Conditional on `resolved.status === "ok" || resolved.status === "err"` — hidden during idle/loading, so the user only sees "refresh" when there IS something to refresh (matches D35's visibility rule).
  - `title` + `aria-label` provide the accessible "Refresh dependencies" hint.
- [x] **CSS** — `.deps-refresh` styles added to `INSPECTOR_CSS` (transparent background, panel-border outline, hover swap, focus-visible ring; uses VS Code semantic vars per D27).
- [x] **App.tsx** — new `onRefresh` callback (sets `resolveState` to `loading` synchronously, posts `refreshResolved` W2E). Passed to all four root-capable cards.
- [x] **Four card prop pass-throughs** — `JourneyCard.tsx`, `InnerJourneyCard.tsx`, `ScriptCard.tsx`, `LibraryScriptCard.tsx` each add `onRefresh: () => void` to their `Props` and forward it to `<ResolvedView>`.
- [x] **Placement note (deviates from D35's literal text):** D35 placed the refresh button "on the card header next to `[↗ open]`"; we placed it inside `ResolvedView`'s section header instead — single code change (touch one shared component, all 4 cards inherit), visually grouped with the data it refreshes. The spirit of "visible + per-card" is preserved. Easy to move to the card header later if a `[↗ open]` action lands there.
- [x] **Tests** — total 362 → **366** (+4):
  - `tests/webview/messages.test.ts` — extended the existing `isW2E` test to cover `refreshResolved`.
  - `tests/webview/inspector/panel.test.ts` — +1 case for the `refreshResolved` roundtrip (verifies `resolverCache.dropOne` is called with the right `ResolverKey` before `resolve`, and a fresh `resolveResult` is posted).
  - `tests/webview/inspector/ui/cards/resolved-view.test.tsx` — +3 cases (button hidden in idle/loading; visible in ok/err; clicking fires `onRefresh`).
  - All 4 card tests had `onRefresh={noop}` threaded into every existing `render(...)` invocation (no new test cases — coverage already provided by ResolvedView's segmented + refresh tests).

**Verification (Slice 5):** lint 0 errors / 156 warnings (no new warnings); typecheck clean across both tsconfigs; tests 362 → **366** (+4 new outcomes); build emits all three bundles cleanly.

**M4 complete.** After Slice 5, every root-capable card (Journey / InnerJourney / Script / LibraryScript) supports Direct / Full tree / Flat toggling + per-card refresh end-to-end. Next milestone: **M5 — Search page (reverse-dep + name + orphans)** per D36.

## M5 — Search page (reverse-dep + name + orphans) ✅

> Per D36 + D21. Standalone Search webview backed by a per-`{host, realm}` realm index. Lazy, user-explicit, isolated.

### Slice 1 — Realm-index data layer ✅

- [x] `src/domain/realm-index.ts` — wire-shape types (`EntityKind`, `RealmIndexEntity`, `ReverseRef`, `RealmIndexEntry`, `entityKeyOf`). Lives in `domain/` so Slice 2's webview message protocol can import them without violating the D21 webview→realm-index boundary (same pattern as `src/domain/resolved-graph.ts`).
- [x] `src/realm-index/build.ts` — `buildRealmIndex(deps, host, realm)`. Per-realm scanner: lists journeys, fetches every node payload (single-level PageNode container walk), BFS over `require()` chains to discover library scripts + ESVs, fetches `listThemes` + `listSocialIdps`, merges `Theme.linkedTrees` reverse-refs. Concurrency-bounded via `mapConcurrent` (cap=10). Per-step errors logged + skipped — partial data survives. Reuses `getScriptIdIfRef` (D19) + `extractScriptBodyRefs` (D20).
- [x] `src/realm-index/cache.ts` — `makeRealmIndexCache({log, build?})`. `peek(host, realm)` synchronous lookup, `build(host, realm, deps)` single-flight, `dropOne(host, realm)`, `dropAllForHost(host)`, `dispose()`. Per D21, this file does NOT import `TenantsRegistry`; per-host invalidation will be wired from `extension.ts` in Slice 2. Per D36, deliberately does NOT subscribe to sidebar-refresh events. Builder errors clear the in-flight entry but don't cache.
- [x] `src/realm-index/queries.ts` — pure functions over `RealmIndexEntry`. `findUsages(entry, targetKey)` reads `inboundRefs`. `searchByName(entry, pattern, kinds?)` case-insensitive locale-aware substring match, sorted by displayName; empty pattern returns `[]`. `findUnused(entry, kinds?)` returns entities with zero inbound refs; excludes `journey` from the default kind set (journeys are entry points by definition).
- [x] **Email-template enumeration gap** — `PaicClient.listEmailTemplates()` doesn't exist. Slice 1 materializes email templates only when a journey references one; `findUnused` for `emailTemplate` returns `[]`. Documented as a Risks item in the slice plan; Slice 2 will either add the list endpoint or surface the gap in the Search UI.
- [x] **Tests** — total 366 → **424** (+58 outcomes):
  - `tests/realm-index/queries.test.ts` — 16 cases covering all three queries (happy paths, empty/missing targets, kind filtering, journey-exception rule, sort stability).
  - `tests/realm-index/build.test.ts` — 15 cases against `makeFakePaicClient`: empty realm, journey/script collection + dedup, library-script chains via `require()`, ESV classification (variable/secret), unknown-ESV omission, theme `linkedTrees` merge, social-IdP orphan-but-listed, inner-journey edges, email-template materialization, per-kind counts, per-step error resilience (node fetch failure + script fetch failure).
  - `tests/realm-index/cache.test.ts` — 11 cases mirroring `tests/resolver/cache.test.ts`: `peek` returns null on miss, `build` invokes + stores, post-build peek, single-flight dedup, `dropOne`/`dropAllForHost` scoped invalidation, error-not-cached, `dispose` clears, per-realm isolation, Disposable shape.
- [x] **D21 boundary test passes.** The pre-existing `src/realm-index` rule now scans real files — confirms no imports from `views/`, `resolver/`, `webview/`, `tenants/`.
- [x] **Verification:** `npm run lint` 0 errors / 157 warnings (+1 baseline-style cognitive-complexity on `buildRealmIndex` matching `walkRoot` / `journey-expand`); typecheck clean across both tsconfigs; `npm run build` emits all four bundles; live-tenant smoke deferred until Slice 2 wires the Search webview.

### Slice 2 — Search webview surface ✅

- [x] `src/webview/search/messages.ts` — typed W2E/E2W discriminated unions + `isW2E` / `isE2W` guards. Eight W2E variants (`ready`/`peek`/`build`/`rescan`/`listEntities`/`query` × 3 modes/`previewByKey`) + nine E2W variants. `SearchPayload` carries `host`, `realm`, optional `prefill` for Slice 3 entry points, `availableRealms`. Lazy `listEntities` round-trip avoids shipping the full entry map across postMessage on every peek.
- [x] `src/webview/search/panel.ts` — `SearchFactory` (single-instance-per-`(host, realm)` map, mirrors D36) + `SearchTab` (one webview panel per key). Message handlers: `peek` (synchronous cache status), `build` (calls `realmIndexCache.build` with single-flight; posts `buildStart` then `buildDone` or `buildError`), `rescan` (`dropOne` then `build`), `query` (dispatches to `findUsages` / `searchByName` / `findUnused` and hydrates result entities for findUsages), `listEntities` (returns grouped entity map for the dropdown), `previewByKey` (delegates to `inspectorFactory.spawnByDescriptor`). Inline `SEARCH_CSS` reuses VS Code semantic vars per D27.
- [x] `src/webview/inspector/panel.ts` — extracted descriptor → PaicNode logic into module-level `buildPaicNodeFromDescriptor` + exported `InspectorFactory.spawnByDescriptor(host, realm, descriptor)` as a public method. Existing `InspectorTab.handlePreviewResolved` rewritten to delegate. Single source of truth per the 2026-05-19 lesson — both Full/Flat resolved-graph clicks (M4) and Search-page result-row clicks (Slice 2) use the same code path.
- [x] `src/webview/search/ui/{main,App}.tsx` — React entry + top-level component (single file holds Header / ModeSwitcher / QueryControls × 3 modes / Results). State shape: `BuildState` (idle/building/err), `QueryState` (idle/running/err/okFindUsages/okByName/okUnused). `useEffect`-registered window message listener routes E2W messages by type. Find-usages mode lazily fires `listEntities` when entered and the cache is built. By-name + Unused use kind-filter chips (multi-select). Result-row click → `previewByKey` → new inspector tab via factory.
- [x] **Build pipeline** — `build:search` + `watch:search` scripts in `package.json`; parent `build` chains five bundles (extension, webview, connection-form, **search**, codicons). `out/search.js` is ~272 KB.
- [x] **Extension wiring** in `src/extension.ts` — constructs `realmIndexCache = makeRealmIndexCache({ log })` + `searchFactory = new SearchFactory({ context, cache, realmIndexCache, inspectorFactory, log })`. `registry.onDidChange` drops realm-index entries for prior hosts + clears searchFactory registry. `paicJourneys.refresh` deliberately does NOT clear realmIndexCache (per D36 — rebuilding is a 10-second-class operation, must be user-explicit via `Rescan`). New `paicJourneys.openSearch` command QuickPicks connection + realm (skipping root realm via D25 filter), then spawns the Search webview.
- [x] **tsconfig updates** — both `tsconfig.json` (extension) and `tsconfig.webview.json` (UI) extended to include / exclude the new `src/webview/search/ui/**` paths.
- [x] **`paicJourneys.openSearch` command** registered in `package.json` `contributes.commands` (title "PAIC: Search…", icon `$(search)`). Command palette accessible (no `commandPalette` `when: false` entry) — no sidebar icon / context menu yet (Slice 3).
- [x] **Tests** — total 424 → **456** (+32 outcomes):
  - `tests/webview/search/messages.test.ts` — 6 cases (every W2E + E2W discriminant + malformed/cross-bundle false-positive rejection).
  - `tests/webview/search/panel.test.ts` — 15 cases (single-instance behavior; peek/build/rescan/query × 3 modes/listEntities/previewByKey roundtrips; queryError when no entry).
  - `tests/webview/search/ui/app.test.tsx` — 9 cases (ready+peek on mount; Header empty/populated states; Build button posts `build`; buildDone refreshes counts; mode switch + query roundtrip; result-row click posts previewByKey; auto-fires listEntities when switching to Find usages with built index; disabled Search button without a selected target).
  - `tests/webview/inspector/panel.test.ts` — 2 new cases for `spawnByDescriptor` (script descriptor opens new tab with select payload; cross-kind coverage via Promise.all on 5 kinds).
- [x] **Verification:** lint 0 errors / 163 warnings (+6 from Slice 1's 157, all baseline-style cognitive complexity on the new scanner / build / queries); typecheck clean across both tsconfigs; `npm run build` emits all five bundles cleanly; D21 boundary test still green.

**Smoke (EDH) deferred** — the data + UI work fully; live-tenant smoke runs when the user manually opens the command palette → "PAIC: Search…" against a real connection.

### Slice 3 — Entry-point integrations ✅

- [x] **Sidebar title-bar `$(search)` icon** — `package.json` `view/title` entry for `paicJourneys.openSearch` lands in `navigation@2` (between Add Connection and Refresh). One-click opens the QuickPick flow.
- [x] **Right-click "Search…" context menus** — `view/item/context` entries on both `viewItem == connection` (group `1@2`) and `viewItem == realm` (group `1@1`) bind `paicJourneys.openSearch`. The command handler now accepts the tree node as its first argument and branches accordingly: `RealmNode` skips both QuickPicks; `ConnectionNode` skips the host picker; no arg (palette / sidebar icon) shows the full flow.
- [x] **Card portal `[🔍 Find usages]` button** on five inspector cards: `ScriptCard`, `LibraryScriptCard`, `EsvCard`, `ThemeCard`, `InnerJourneyCard`. Per D36, `JourneyCard` is intentionally excluded — root journeys are entry points, "find usages" of one is a degenerate query.
- [x] **Inspector W2E protocol** extended with a `findUsages` variant carrying `{host, realm, kind, id, displayName, isLibrary?, esvKind?}`. `isW2E` guard updated. Routed via `vscode.commands.executeCommand("paicJourneys.findUsages", ...)` in `panel.ts` `onMessage` — mirrors the existing `openScriptBody` / `openEmailTemplateBody` pattern, so the inspector tab never imports `SearchFactory` directly.
- [x] **New `paicJourneys.findUsages` command** registered in `extension.ts` (palette-hidden via `commandPalette.when = false`). Translates the descriptor to a `SearchPrefill` and calls `searchFactory.spawn(host, realm, { mode: "findUsages", targetKind, targetKey: entityKeyOf(kind, id) })`. Defensive arg parser (`parseFindUsagesArg`) duck-types the payload + rejects unknown kinds.
- [x] **Search-page prefill auto-run** — `src/webview/search/ui/App.tsx` gains a `useRef`-guarded `useEffect` that fires `onSearch()` once when the embedded prefill carries `mode: "findUsages"` + `targetKey` AND the realm index is built AND the dropdown selection matches. If the index isn't built when the page opens, the prefill seeds the dropdown; the user clicks Build, listEntities re-fetches, and the auto-run effect fires.
- [x] **Tests** — total 456 → **463** (+7 outcomes):
  - `tests/webview/messages.test.ts` — +1 case (W2E guard accepts `findUsages`).
  - `tests/webview/inspector/panel.test.ts` — +1 case (`findUsages` W2E dispatches `paicJourneys.findUsages` via `executeCommand` with the right descriptor).
  - `tests/webview/inspector/ui/cards/{script,library-script,esv,theme,inner-journey}-card.test.tsx` — +1 case each (button click fires `onFindUsages` with the right descriptor).
  - `tests/webview/search/ui/app.test.tsx` — +1 case (auto-run fires once when prefill + built cache align; repeated peekResult does NOT re-trigger thanks to the one-shot ref).
- [x] **Verification:** lint 0 errors / 163 warnings (no new); typecheck clean across both tsconfigs; `npm run build` emits all five bundles; D21 boundary test still green.

### Slice 4 — Search page UX redesign: singleton page + in-page dropdowns ✅

User feedback after Slices 2+3 reshaped the entry-point UX: instead of QuickPick prompts gating the page open, the Search page now **opens immediately** with two in-page dropdowns (Connection + Realm). This **amends D36** — see the "Singleton Search page (AMENDED 2026-05-19)" note in `docs/design-plan.md`.

- [x] **D36 amended** — the original "single instance per `(host, realm)`" rule is superseded. With realm as an in-page dropdown, per-realm tabs are incoherent → the Search page is now a **singleton**. Re-invoking any entry point focuses the one tab and re-seeds its dropdowns.
- [x] `src/webview/search/messages.ts` reworked — `SearchPayload` now carries `connections` (the dropdown list, shipped in the embedded payload) + `selectedHost` / `selectedRealm` (pre-selection) instead of fixed `host`/`realm`. New `listRealms` W2E + `realmsResult` / `realmsError` E2W (realm lists need a `client.listRealms()` call per connection, fetched on demand). Every host/realm-scoped W2E now carries `host` + `realm` explicitly; every result E2W echoes them so the React app drops stale replies after a mid-flight dropdown change.
- [x] `src/webview/search/panel.ts` — `SearchFactory` is now a singleton manager (`spawn(opts)` focuses-or-creates one tab; takes a `listConnections` dep read fresh per spawn). `SearchTab` is stateless w.r.t. selection — every handler reads `host` / `realm` from the message. New `listRealms` handler filters the root realm (D25). `clearRegistry()` re-renders the open tab with the fresh connection list.
- [x] `src/webview/search/ui/App.tsx` — new `ScopeSelector` (two `<select>` dropdowns). Connection-change → fetch realms (cached per host in `realmsByHost`). The cache-status header / query controls / results render **only once both dropdowns are set**, gated on `scopeReady`. All W2E posts thread the current `(host, realm)`; the message listener drops results whose `(host, realm)` ≠ current selection.
- [x] `src/extension.ts` — `paicJourneys.openSearch` drops its QuickPick flow entirely: it just `searchFactory.spawn(opts)` with `selectedHost` / `selectedRealm` pre-filled from a `RealmNode` / `ConnectionNode` arg (or nothing from the palette / sidebar icon). `paicJourneys.findUsages` spawns with `{ selectedHost, selectedRealm, prefill }`. The old `pickRealmForSearch` QuickPick helper is deleted. `SearchFactory` gains a `listConnections` dep.
- [x] **Tests reworked** — `tests/webview/search/{messages,panel}.test.ts` + `ui/app.test.tsx` rewritten for the new protocol, singleton factory, and dropdown-driven scope. 30 search-test outcomes (5 messages + 15 panel + 10 App). Total **462 passing**.
- [x] **Verification:** lint 0 errors / 163 warnings; typecheck clean; `npm run build` emits all five bundles; D21 boundary test green.

### Slice 5 — Realm-index build performance ✅

Live sb3 smoke surfaced a slow build: `alpha` took **108 s** (~2,300 HTTP calls). Log analysis found two issues — see the `docs/lessons.md` 2026-05-19 "Nested `mapConcurrent`" entry + the "Build concurrency" note in `design-plan.md` D36.

- [x] **One shared per-build limiter.** Nested `mapConcurrent(…, 10)` calls multiplied to ~80 concurrent in-flight (getNode avg latency ballooned to 2,485 ms from tenant-side queuing). Replaced with a single `makeLimiter(10)` instance created per `buildRealmIndex` call, stored on `BuildState`, threaded through every `PaicClient` call across every phase. True cap-10, matches the tree + resolver, far gentler on the tenant (D16). Per-build instance — never shared with the tree-lazy or resolver caches (D21 intact).
- [x] `src/paic/concurrency.ts` — added `makeLimiter(n)` returning `{ run<T>(task) }`. Pure concurrency primitive alongside `mapConcurrent`; caps total in-flight across all `run()` calls on the instance (vs `mapConcurrent` which caps its own per-call pool).
- [x] **Batched script-phase library lookups.** The `require()`-chain BFS `await`ed `getScriptByName` per-script inside a `for` loop → effective concurrency ~4. `scanScripts` now does a first pass (enrich entities + collect the layer-wide union of library names) → one batched `getScriptByName` lookup → second pass emitting edges from the resolved map. Extracted `fetchScript` + `enrichScriptEntity` helpers.
- [x] `tests/paic/concurrency.test.ts` — +4 `makeLimiter` cases (caps in-flight across independent `run()` calls; resolves with task result; a rejected task frees its slot + propagates; throws on `n < 1`). `build.test.ts` stays green — all 15 cases pass unchanged (behavior identical; only call scheduling differs).
- [x] **Verification:** lint 0 errors / 163 warnings; typecheck clean; 462 → **466 tests**; build emits all 5 bundles.
- [x] **Re-smoke confirmed (sb3 `alpha`)** — build time **108.5 s → 67.8 s** (−37%). Identical output (778 entities / 1,864 refs). Total HTTP calls 2,259 → 1,863 (layer-wide dedup of `require()` lookups). getNode per-call latency **2,485 ms → 334 ms** (no longer bursting ~80-wide and overwhelming the tenant — true cap-10). Scripts phase ~58 s → ~17 s (serialization removed; true cap-10). getNode phase stayed ~flat at ~42 s — the predicted trade: same speed, far gentler per call.

### Slice 6 — Build progress indicator ✅

A realm-index build is a ~68 s foreground operation; the Search page previously showed a static "Building realm index…" string for the whole wait. Slice 6 replaces it with a live progress bar.

- [x] `src/realm-index/build.ts` — `RealmIndexBuildDeps` gains an optional `onProgress(p: BuildProgress)` callback. `BuildProgress = { phase: "preparing" | "journeys" | "scripts" | "finishing"; done?: number; total?: number }`. **Both** long phases report a unified `done` / `total`: the journey scan per completed journey (`total` = journey count); the script-BFS per fetched script, where `total` is the BFS's `enqueued`-set size — it seeds with the journey-referenced frontier and grows as library scripts surface, so `done` chases it and the phase ends at `N / N` (same `X / Y` label shape as journeys).
- [x] **Overlap optimization** (folded in) — the tenant ESV-index fetch now runs concurrently with `listJourneys` (one `Promise.all`); `listThemes` + `listSocialIdps` run concurrently with the script-body BFS. The phases touch disjoint `BuildState` slices; the synchronous `materializeEntity` / `addEdge` writes never tear (JS single-threaded).
- [x] `src/realm-index/cache.ts` — no change needed; `onProgress` rides through transparently inside `RealmIndexBuildDeps`, which `cache.build()` already forwards to `buildRealmIndex`.
- [x] `src/webview/search/messages.ts` — new `buildProgress` E2W message `{ host, realm, phase, done?, total? }`; `isE2W` updated.
- [x] `src/webview/search/panel.ts` — `handleBuild` passes an `onProgress` that **coalesces** updates: an immediate post on every phase change, otherwise throttled to ~5 Hz (`PROGRESS_THROTTLE_MS = 200`) — never one message per journey.
- [x] `src/webview/search/ui/App.tsx` — `BuildState.building` carries `progress` + a `pct`; the Header renders a **progress bar + phase label + percentage** (full header width) while building — e.g. `Scanning journeys — 87 / 142` or `Resolving scripts — 300 / 540` over a filled bar. Bar fill uses `--vscode-progressBar-background` (D27). Percentage spans four contiguous monotonic bands (preparing 0–5 %, journeys 5–78 %, scripts 78–98 %, finishing 98–100 %); both determinate phases interpolate within their band by `done`/`total`. Because the script `total` grows, the displayed `pct` is **clamped monotonically** in the message handler (`Math.max(raw, prevPct)`) — a progress bar never retreats.
- [x] Tests — total 466 → **471**: `build.test.ts` +1 (`onProgress` fires across phases with determinate journey `done`/`total`); `panel.test.ts` +1 (`buildProgress` relayed from the builder's `onProgress`); `app.test.tsx` +3 (journey-phase bar; scripts-phase bar with unified `X / Y` label; monotonic clamp holds the bar when the script total grows).
- [x] **Verification:** lint 0 errors / 163 warnings; typecheck clean; build emits all 5 bundles.

### Slice 7 — Find-usages results: grouped list + path tree ✅

Find-usages previously rendered a flat one-hop `kind · name → via` list. Two improvements (user-reviewed mockups, approved) — both derived purely from the in-memory `RealmIndexEntry.inboundRefs`, no new fetches or cache changes:

- [x] **Kind-grouped result list** — all three query modes render results under `── <Kind> (N) ──` divider headers with codicons, alphabetical within kind (the inspector-card / sidebar vocabulary). New pure helper `src/webview/search/ui/grouping.ts` — `displayKindOf` (splits `script` by `isLibrary`), `DISPLAY_KIND_LABEL` / `DISPLAY_KIND_ICON`, generic `groupByKind<{entity}>`.
- [x] **Path-tree view** — a `List | Tree` segmented toggle on Find-usages results (resets to List on each new query). Tree shows every path from a journey root down to the searched entity (the searched thing is the leaf). New pure query `findUsagePaths(entry, targetKey): UsagePaths` in `src/realm-index/queries.ts`: reverse-reachability BFS over `inboundRefs` to collect ancestors → relevant-restricted forward adjacency → roots (journeys; non-journey roots flagged `orphanRoot` = dead-code path) → forward DFS render in display order with a shared `rendered` set (first displayed occurrence wins; repeats / cycles collapse to `(dup)`).
- [x] `src/domain/realm-index.ts` — `UsagePathNode` + `UsagePaths` types (in `domain/` so producer + webview both import, per the `ResolvedGraph` precedent).
- [x] `src/webview/search/messages.ts` — `queryResult` findUsages variant gains `paths: UsagePaths` (computed alongside `refs` — same `entry`, cheap, no extra round-trip; the `List|Tree` toggle is client-side).
- [x] `src/webview/search/panel.ts` — `handleQuery` findUsages computes + posts `paths`; `SEARCH_CSS` gains `.search-divider` + `.search-tree*`.
- [x] `src/webview/search/ui/{grouping.ts, UsagePathTree.tsx, App.tsx}` — recursive tree renderer (codicon + `via` + `(dup)` + `⚠ no journey reaches this` for orphan roots); App threads grouped lists for all modes (new `GroupedList` / `EntityRow` / `ResultDivider`), the `List|Tree` `UsagesViewToggle`, and `usagesView` state; tree nodes click → `previewByKey`.
- [x] Tests — total 471 → **481**: `queries.test.ts` +7 `findUsagePaths` (linear chain, via labels, multi-root, dup, cycle, orphan root, unknown target); `messages` / `panel` extended for the `paths` field; `app.test.tsx` +3 (kind-grouped dividers, `List|Tree` toggle defaulting to List, switching to Tree renders the path tree).
- [x] `docs/design-plan.md` D36 — "Result rows" note amended for the grouped list + path-tree view.
- [x] **Verification:** lint 0 errors / 164 warnings (+1 baseline-style cognitive-complexity on `findUsagePaths`); typecheck clean across both tsconfigs; `npm run build` emits all 5 bundles.

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

## M8 — On-prem PingAM / ForgeRock AM support ✅ (Slices 1–5; deferred polish noted) — D41

POC complete: live AM 7.5.2 bed at `poc/onprem-am/` (Vagrant+libvirt), endpoint audit (`ENDPOINT-AUDIT.md`), and a seeded journey graph exercising every on-prem-available edge. Auth + all Tier-A endpoints verified against the bed via `smoke.sh` / `audit-endpoints.sh`.

### Slice 1 — Connection model ✅
- [x] `domain/types.ts` — `Connection` → `kind`-discriminated union (`PaicConnection` | `OnpremConnection`); `host` common
- [x] `normalizeConnection` helper: legacy config (no `kind`) → `paic` (back-compat); applied in `registry.list()`
- [x] Compile sites updated: `extension.ts` add/edit (kind:paic + edit guarded paic-only), `connection.ts` tooltip, `ConnectionCard.tsx` (show username vs saId)
- [x] `tests/domain/types.test.ts` — `normalizeConnection` (4 cases)

### Slice 2 — Auth-strategy seam ✅
- [x] `src/auth/strategy.ts` — `AuthStrategy { getAuthHeaders({ forceRefresh? }): Promise<Record<string,string>> }`
- [x] `src/auth/paic-strategy.ts` — lifts `mintToken` + token cache (30s margin) → `Authorization: Bearer`
- [x] `src/auth/onprem-strategy.ts` — fetch-based `authenticate` + `serverinfo` cookie-name discovery + session cache → `Cookie: <name>=<token>` (no TTL; relies on 401 self-heal)
- [x] `paic/http.ts` — consumes an `AuthStrategy` (was `getToken`); 401 flags `paicForceAuthRefresh` → request interceptor re-auths
- [x] `tenants/client-cache.ts` — selects strategy by `conn.kind`; kind-aware no-credentials message
- [x] Tests: `tests/auth/{paic,onprem}-strategy.test.ts` (6 each); migrated `http.test.ts` (9) + `client-cache.test.ts` (+2 kind-branch); ConnectionCard onprem render
- [x] **Verified**: lint 0 errors, typecheck clean, 523 tests green, esbuild build clean, and a throwaway live check authenticated against the bed (`Cookie: iPlanetDirectoryPro=…`)

### Slice 3 — Shared-client parameterization ✅
- [x] `paic/client.ts` — `amPath` option (default `/am`) prefixes the 7 AM URLs; `onprem-strategy.ts` `amPath` option for serverinfo/authenticate
- [x] `client.ts` — `ClientCapabilities { themes, emailTemplates, esvs }` short-circuits the 6 IDM/IDC methods to `null`/`[]` (no HTTP) when disabled
- [x] `client-cache.ts` — derives `{ origin, amPath, capabilities }` from the connection (paic → `/am`+all-true; onprem → path-from-URL + all-false); passes origin as the http baseURL (avoids double `/am`)
- [x] On-prem root realm: `connection.ts` filter kind-conditional (onprem shows root); `realm.ts` `RealmNode` labels root "Top Level Realm" + passes `""` to `listJourneys` (robust `/realms/root`)
- [x] Tests: `client.test.ts` (short-circuit + injected amPath), `onprem-strategy.test.ts` (custom amPath), `client-cache.test.ts` (per-kind amPath/capabilities/origin + custom-path derivation), `connection.test.ts` (onprem shows root), `realm.test.ts` (root node)
- [x] **Verified**: lint 0 errors, typecheck clean, 529 tests green, build clean, and a throwaway live check (onprem client `listJourneys("")` → `OnPremLogin`/`OnPremMfaInner`; `listThemes` short-circuits to `[]` with no `/openidm` 404)

### Slice 4 — Form + creation flow ✅
- [x] `connection-form/messages.ts` — `ConnectionFormData`/`Initial` → `kind`-discriminated unions; `validateResult` `expiresIn`/`droppedScopes` optional (on-prem has no token TTL)
- [x] `connection-form/ui/App.tsx` — connection-type radio toggle (locked in edit), two field groups (PAIC: saId+JWK · on-prem: base URL+username+password), per-kind `validate()`, on-prem-aware result banner
- [x] `connection-form/panel.ts` — `getExistingJwk`→`getExistingSecret`; `handleValidate` branches by kind (on-prem `testOnprem` authenticates via `makeOnpremAuthStrategy`); kind-toggle CSS
- [x] `src/paic/am-url.ts` (new) — shared `amOrigin`/`amContextPath` (lifted from `client-cache`), reused by the form's on-prem test
- [x] `extension.ts` — add/edit construct the `Connection` variant via `connectionFromFormData`; generalized missing-secret guard; **un-gated `editConnection`** for on-prem
- [x] `package.json` — `paicJourneys.connections` schema gains `kind` + `username` + updated description
- [x] Search root-realm filter for on-prem: `ConnectionInfo`+`kind`, `listConnections`+`kind`, `SearchTabDeps.connectionKindOf`, `handleListRealms` branches (root shown for on-prem)
- [x] Tests: `tests/paic/am-url.test.ts` (new), `app.test.tsx` (kind toggle + on-prem validation/save + edit lock + pre-fill)
- [x] **Verified**: lint 0 errors, typecheck clean, 541 tests green, all 4 bundles build, and a throwaway live check (the form's on-prem `testOnprem` path authenticated against the bed → `Cookie: iPlanetDirectoryPro=…`)
- Deferred: registry secret-API rename (`getJwk`→`getSecret`, `saJwk.`→`secret.`) — cosmetic, generic storage already holds on-prem passwords; friendlier on-prem root-realm label in the Search dropdown (shows "/" for now)

### Slice 5 — Tests ✅
- [x] Unit (done across Slices 1–4): `onprem-strategy`, `paic-strategy`, `client-cache` kind-branch, `normalizeConnection`, `am-url`, the kind-split form
- [x] Live: `tests/integration/onprem-live.integration.test.ts` — permanent, gated by `PAIC_LIVE=1` (self-skips otherwise), against the `poc/onprem-am/` bed. 7 tests through the real shipped client code: listRealms (root present), listJourneys, node→script resolve chain, getScriptByName (LIBRARY), listSocialIdps, Tier-B/C short-circuit. `ONPREM_AM_{HOST,USER,PASSWORD}` overridable; documented in `.claude/rules/testing.md`.
- [x] **Verified**: lint 0 errors, typecheck clean; default `npm test` → suite skips (541 pass + 7 skipped); `test:fast` excludes it; `PAIC_LIVE=1 npm test` → 7 on-prem live tests green against the bed

---

## M9 — Cross-environment transfer (export / import / compare) ⏳ — D42

> New initiative. Read-only **export** first (within D6); import (write) is a later phase that will amend D6. Running decisions + endpoint results live in `poc/transfer-endpoints/{DESIGN-DECISIONS,TRACKER}.md` (gitignored).

### POC — endpoint CRUD research ✅ (gitignored `poc/transfer-endpoints/`)

- [x] Round-trip CRUD probes for all 7 leaves against PAIC sb2x — email template, ESV variable, social IdP, script, library script, theme, ESV secret — every verb confirmed and cleaned up
- [x] On-prem VM (AM 7.5.2): the 3 AM-native leaves (script / library script / social IdP) behave **identically** to PAIC; the 4 IDM/platform leaves confirmed **N/A** on bare AM
- [x] Captured per-leaf endpoints + diff masks + cross-leaf findings (client-chosen UUID preserved; secrets redacted; create-vs-update signal varies per leaf) → promoted into D42
- [x] Format decided: frodo/PAIC-UI `{meta, trees}` (journeys) + per-type `{meta, <kind>:{<id>:raw}}` (leaves); two-axis options (contents always, depth toggle); `meta` on-by-default (TD-1 / TD-2)

### Phase 1 — Leaf node export ⏳ (current)

**Slice 1 — Export engine + script end-to-end ✅**
- [x] `src/paic/client.ts` — `getRawScript(realm, id)` raw accessor (unmapped wire object); `getScript` refactored to delegate to it (no URL duplication)
- [x] `src/export/serialize.ts` — pure serializer: frodo per-type shape `{meta, script:{<id>:raw}}` + strip diff-mask fields (keep `_id`) + stringified-decoded script body (isolated in `scriptBodyToExport()`)
- [x] `src/export/meta.ts` — pure `buildExportMeta(conn, realm, version, nowIso)` (date injected → deterministic); maps `kind` → `connectionType` (`am-onprem`), `saId`/`username` → `exportedBy`
- [x] `src/commands/export-component.ts` — `exportComponent(deps, arg)`: raw-fetch → serialize → `showSaveDialog` → `workspace.fs.writeFile`; cancel/bad-arg/error paths logged + surfaced
- [x] `messages.ts`: `exportComponent` W2E variant + `isW2E`; `panel.ts:onMessage` routes it to the command (mirrors `openScriptBody`)
- [x] `App.tsx` `onExport` callback + `ScriptCard` **Export…** button (mirrors `onOpenBody`); `extension.ts` registers the command; `package.json` declares it (hidden from palette)
- [x] Tests: `serialize.test.ts` (shape / mask-strip / body form), `meta.test.ts` (paic + onprem), `export-component.test.ts` (happy / cancel / bad-arg), `client.test.ts` (raw passthrough); `vscode-mock` extended with `showSaveDialog` / `showInformationMessage` / `Uri.file` / `workspace.fs.writeFile`
- [x] Verified: `/check all` green (0 lint errors, typecheck clean, 559 tests pass); `npm run build` → extension.js + webview.js clean

**Slice 2 — Fan out to the remaining five leaf cards ✅**
- [x] `src/paic/client.ts` — 4 raw accessors: `getRawTheme`/`getRawEmailTemplate` (mapped getters refactored to delegate) + `getRawSocialIdp`/`getRawEsv` (independent; `getRawEsv` returns `RawEsvResult` = discovered `{kind, raw}`)
- [x] `src/export/serialize.ts` — generalized to `serializeLeaf(kind, raw, meta, fallbackId)` over frodo per-type keys (`theme`/`emailTemplate`/`idp`/`variable`/`secret`); keyed by wire `_id`; body-transform scripts only; `_type` retained for social IdP
- [x] `src/commands/export-component.ts` — `fetchAndSerialize` switch over six message kinds (esv → variable/secret via the accessor's kind); null result → error + no write; filename `<name>.<typeLabel>.json`
- [x] `messages.ts` `ExportComponentKind` + widened W2E variant; `App.tsx` `onExport` passed into all five cases; **Export… button on all five cards** (EmailTemplate + SocialIdp got a new `card-actions` div)
- [x] Theme source is the whole `themerealm` doc (`getRawTheme` filters the realm array); ESV secret export is metadata-only by nature (value never returned) — no special code
- [x] Tests: `serialize.test.ts` `serializeLeaf` per-kind cases; `client.test.ts` 4 raw-accessor tests; `export-component.test.ts` theme/esv/not-found cases; `vscode-mock` + `fakes.ts` extended
- [x] Verified: `/check all` green (0 lint errors, typecheck clean, **571 tests pass**); `npm run build` → extension.js + webview.js clean

**Slice 3 — Interop verification (per D42 contract)**
- [ ] Round-trip: our leaf export → `frodo <kind> import` and the PAIC-UI Import → confirm it lands (golden refs in `poc/`)

### Phase 2 — Journey / sub-journey export ✅ (TD-5)

> Same `{meta, trees}` envelope for both depths (no structural fork); depth carried by content + recorded in `meta`. Contents always bundled (TD-1); only inner-journey depth is a choice.
- [x] `src/paic/client.ts` — `getRawJourney` / `getRawNode` / `getRawScriptByName` raw accessors (+ mapped getters refactored to delegate)
- [x] `src/export/journey-bundle.ts` — **dedicated raw per-tree walk** (not the resolver — it's mapped/flat/no-host): raw-fetch each node, `mapNodePayload` locally for discovery (`getScriptIdIfRef`, themeId, emailTemplateName, filteredProviders, childRefs, inner-tree), keep raw for the bundle. Per-tree `SingleTreeExport` (nodes / innerNodes / scripts incl. transitive `require()` libs / themes / emailTemplates / socialIdentityProviders); `buildJourneyBundle` does level-1 vs all-levels BFS with a `visited` cycle guard. **ESVs not bundled** → `requires.esvs` (TD-1/TD-4)
- [x] `src/export/serialize.ts` — `stripMask` exported; `ExportMeta` extended with `depthMode` / `treesSelectedForExport` / `innerTreesIncluded` / `requires`
- [x] `src/commands/export-journey.ts` — QuickPick depth (`Level 1 only` default / `All levels`) → `showSaveDialog` → `vscode.window.withProgress`(walk + write); cancel/not-found/error paths
- [x] UI: `exportJourney` W2E + `panel.ts` route; `App.tsx` `onExportJourney`; **Export… button on `JourneyCard` (new actions block) + `InnerJourneyCard`**; `extension.ts` + `package.json` registration
- [x] Tests: `journey-bundle.test.ts` (level1 / allLevels / cycle / transitive-lib / mask+body / missing-journey), `client.test.ts` (3 raw accessors), `export-journey.test.ts` (depth-pick → write / pick-cancel / save-cancel); `vscode-mock` gains `withProgress` + `ProgressLocation`
- [x] Verified: `/check all` green (0 lint errors, typecheck clean, **582 tests pass**); `npm run build` → extension.js + webview.js clean

### Phase 4 — Import (write — amends D6) ⏳ (current) — TD-6

> The first **write** phase. Design locked in **TD-6** (dedicated Transfer page · file-first workflow · per-component compat gate · three-tier compare over **fresh REST**, not the index · validate-before-first-write). Endpoint mechanics already proven by the endpoint-CRUD POC (**7/7 PAIC + 3/3 on-prem**) → the leaf batches are a **build, not a POC**. Risk-staged in 3 batches.

**Batch 1 — atom leaves (theme · email template · social IdP)** ⏳ — plain-object writes; no body transform, no closure. CRUD-proven → build-ready. Sliced **read-only-first, write-last** (A → B → C).

**Slice A — Transfer page scaffold + Source preview (read-only) ✅**
- [x] `src/import/parse.ts` (pure, no vscode) — `parseBundle(text)` recognizes a bundle from its top-level key (`trees` → journey; one of `script`/`theme`/`emailTemplate`/`idp`/`variable`/`secret` → that leaf) and summarizes it (`ParsedBundle`: meta · kind · type-chip label · components · inventory). Email `emailTemplate/<name>` prefix stripped; idp provider type from `_type._id`; journey aggregates node/script(+lib)/theme/email/idp counts + `requires`/`innerTreesIncluded`. Never throws → `{ok:false,error}`.
- [x] `src/webview/transfer/` — **4th React surface** (→ `out/transfer.js`): `messages.ts` (W2E `ready`/`pickBundle`; E2W `bundleLoaded`/`bundleError`; re-exports the parse types so `ui/*` imports only from `../messages`), `panel.ts` (`TransferFactory` singleton + `TransferTab`; `pickBundle` → `showOpenDialog` → `fs.readFile` → `parseBundle` → post; CSP+nonce, no network/writes), `ui/main.tsx` bootstrap, `ui/App.tsx` file-first Source preview (Choose bundle… → chip + meta block + inventory + component rows; error banner).
- [x] Wiring: `package.json` `build:transfer`/`watch:transfer` (+ in `build`), `paicJourneys.openTransfer` command + sidebar `view/title` button (`$(cloud-upload)`, navigation@3; refresh→@4); `extension.ts` instantiates `TransferFactory` + registers the command; `tsconfig.json` excludes + `tsconfig.webview.json` include for `transfer/ui`; `layer-boundaries.test.ts` adds the `transfer/ui` D21 case.
- [x] Tests: `src/import/parse.test.ts` (11 — leaf kinds, email prefix, idp type, lib context, journey level1/allLevels counts + requires, missing-meta, invalid/unknown/ambiguous errors) + `tests/webview/transfer/ui/app.test.tsx` (3 — pickBundle post, Source preview render, error banner).
- [x] Verified: `/check all` green (0 lint errors, typecheck clean, **597 tests**, +15); `npm run build` emits all 5 bundles incl. `out/transfer.js`. **100% read-only — no D6 change.** Manual EDH pending.

**Slice B1 — Target selection + Compat gate (read-only) ✅**
- [x] **Combobox extracted to a shared module** (D38 single-primitive): `src/webview/shared/combobox.tsx` (`Combobox` + `ComboboxOption`, moved verbatim from `search/ui/App.tsx`, gained an `emptyLabel` prop) + `src/webview/shared/combobox-css.ts` (`COMBOBOX_CSS`, moved from `search/panel.ts`'s inline CSS). Search now imports both (call sites pass `emptyLabel="No entity matches"` to stay identical); Transfer reuses them. `tsconfig.json` excludes `src/webview/shared/**` from the base build.
- [x] `src/import/compat.ts` (pure) — `compatFor(kind, targetKind)`: on-prem supports only `script` + `socialIdp`; paic supports all. Re-exported via `transfer/messages.ts`.
- [x] Target UI: `transfer/messages.ts` += W2E `listRealms` / E2W `realmsResult`·`realmsError`; `transfer/panel.ts` gains `cache` + `connectionKindOf`, a `handleListRealms` (mirrors Search's root filter), stores `this.loaded` + **re-hydrates the preview on `ready`** (survives a refresh/re-spawn remount), and adds the codicon `<link>` + `font-src` CSP for the Combobox chevron. `transfer/ui/App.tsx` adds a **Target** section (Connection + Realm via the shared Combobox + `realmsByHost`/`listRealms` effect) and **client-side compat verdicts** (`✓ supported` / `✗ not supported on on-prem AM`) per component; journey bundles show a deferral note (no Target). `extension.ts` threads `cache` + `connectionKindOf`.
- [x] Tests: `src/import/compat.test.ts` (3 — paic-all-ok, onprem AM-native-ok, onprem IDM-leaves-unsupported) + `app.test.tsx` (+5 — Target renders for leaf, journey deferral note, `listRealms` posted on connection pick, ✓ verdict on paic, ✗ verdict for theme→onprem). Search tests stay green (verbatim move + restored empty-label).
- [x] Verified: `/check all` green (0 lint errors, typecheck clean, **605 tests**, +8); `npm run build` emits all 5 bundles. **Still read-only — no D6 change.** Manual EDH pending (incl. Search dropdowns still styled after the CSS move).

**Slice B2 — Compare (read-only pre-flight) ✅**
- [x] `src/import/compare.ts` (pure) — `classifyCompare(kind, bundleRaw, targetRaw)` → `new` (target absent) / `identical`·`differs` (atoms, via `stableStringify(normalizeForCompare(...))`) / `exists` (script/variable/secret = existence-only). `normalizeForCompare` = `stripMask` **+ drop `_id`** (identity, kills the email-prefix / theme-`_id`-regen false-diffs) + theme drop `linkedTrees`+`isDefault`, idp drop `clientSecret`+`_type`. `stableStringify` = recursive key-sorted JSON (no deep-equal lib). `ComponentVerdict`/`ComponentStatus` types here.
- [x] `src/import/preflight.ts` (client injected → testable) — `runPreflight(client, realm, targetKind, rawComponents)`: per component, **compat gates the fetch** (`unsupported` → no REST call), else `fetchTarget` by identity (theme/email/idp/script-by-name/esv; idp by `raw._id`; esv requires discovered-kind match) → `classifyCompare`; `Promise.all` with per-component try/catch → `error` verdict on a throw (no blank plan).
- [x] `src/import/parse.ts` — single-pass **raw-carry**: `ParseResult.ok` gains `rawComponents: ImportComponent[]` (leaf raw objects, kept **extension-side only** — never posted); journey → `[]`.
- [x] Wiring: `transfer/messages.ts` += W2E `runPreflight` / E2W `preflightResult`·`preflightError` (re-exports `ComponentVerdict`/`ComponentStatus`; drops the now-unused `compatFor` re-export). `transfer/panel.ts` stores `rawComponents` + `handleRunPreflight` (compat moves panel-side). `transfer/ui/App.tsx` replaces B1's client-side compat with a **Plan** section — auto-posts `runPreflight` on (leaf + target) set, "Checking target…" pending, verdict badges (✚ New / = Identical / ● Differs / • Present / ✗ unsupported / ⚠ error), drops stale replies by echoed host+realm.
- [x] Tests: `compare.test.ts` (13 — identical-despite-drift per kind, differs, existence-only, stableStringify order-independence, normalize masks, no-mutation), `preflight.test.ts` (8 — unsupported-no-fetch, new, identical/differs, script-by-name, esv kind-mismatch→new, throw→error, multi-component), `parse.test.ts` (+3 rawComponents), `app.test.tsx` (runPreflight+pending, verdict render, unsupported render).
- [x] Verified: `/check all` green (0 lint errors, typecheck clean, **630 tests**, +25); `npm run build` emits all 5 bundles. **Still read-only — no D6 change.** Manual EDH pending.

**Slice C — Execute (the writes — amends D6 → D43) ✅**
- [x] `src/paic/http.ts` — `put` added to `HttpClient` (idempotent; caller `If-Match` headers preserved). `src/paic/client.ts` — `writeEmailTemplate` (`PUT /emailTemplate/<name>`, 201/200), `writeSocialIdp` (`PUT …/<typeId>/<id>`, 201/200), `writeTheme` (**`If-Match`-guarded whole-doc splice** of `themerealm`: preserves siblings, overwrite keeps target `isDefault` / create→false, **412 → re-GET/re-splice once**). Capability guard = **throw** on a no-IDM backend.
- [x] `src/import/write.ts` (pure) — inverse transforms: `toEmailWrite` (strips `_id`), `toIdpWrite` (typeId from `_type._id`, drops `_type`, keeps `_id`, sets re-supplied secret), `toThemeWrite` (drops `linkedTrees`), `idpNeedsSecret`, `emailTemplateName`. `src/import/execute.ts` (client injected) — **sequential** `runExecute` (themes self-race under parallel), attempt-all/no-rollback, per-component `WriteResult` (created/overwritten/skipped/failed); idp-no-secret → `skipped` (never blank-writes).
- [x] Wiring: `transfer/messages.ts` += W2E `execute` / E2W `executeResult` (+ guards, `WriteResult` re-export). `transfer/panel.ts` `handleExecute` — **validate-before-write** (fresh `runPreflight`) → join verdicts→raw by `(kind,id)` → empty? skip modal → **`showWarningMessage({modal:true})`** naming host+realm/counts/no-undo → **then** `showInputBox({password:true})` per idp → `withProgress` `runExecute` → post results → re-run preflight (refresh Plan) + drift warning. `transfer/ui/App.tsx` Plan section gains an **"Import N components"** button (atoms + writable) / a deferral note (non-atom leaf) + the write log.
- [x] D6 amendment recorded as **D43** (design-plan.md); non-goal updated.
- [x] Tests: `write.test.ts` (6), `execute.test.ts` (5 — outcomes, idp-skip-no-secret, throw→failed, **sequential** order), `client.test.ts` (+7 — email strip-`_id`/201-200, idp URL+version, theme `If-Match` splice + sibling-preserve + isDefault create/overwrite + **412 retry** + no-IDM throw), `app.test.tsx` (+3 — Import button posts execute, write log render, non-atom note).
- [x] Verified: `/check all` green (0 lint errors, typecheck clean, **651 tests**, +21); `npm run build` emits all 5 bundles. **Writes a tenant — D6 amended (D43).** Manual EDH (writes the sb2x throwaway) pending.

> **Batch 1 (atom-leaf import) complete** — read-only Source/Target/Compare (A/B) + the create+overwrite writes (C) for theme · email template · social IdP, modal-gated.

**Batch 2 — ESV + script/lib** *(ESV design decided — TD-7; apply cycle POC-proven)*
- **ESV import — Slice 1: writes (create-only) ✅** — `src/paic/client.ts` `writeEsvVariable`/`writeEsvSecret` (`PUT /environment/variables|secrets/<hyphen-id>`, ESV api version, caps-guard **throw**, hardcoded `"created"` since ESV create returns 200). Pure `toVariableWrite` (write the bundle's `valueBase64` directly — whitelist `valueBase64`/`expressionType`/`description`) + `toSecretWrite(raw, plaintext)` (base64-encode the prompted value once; keep `encoding`/`useInPlaceholders`/`description`). `execute.ts` ESV cases — variable no prompt; **secret** prompts via `showInputBox({password:true})` (panel), no value → `skipped`, **400 "already exists" → `skipped`** (not failed). `parse.ts` **decodes the variable value** into the Source preview (D22 non-secret; never logged); secret shows "value supplied at import". `WRITABLE_KINDS` **centralized** (`src/import/kinds.ts`, re-exported via messages) → panel + UI share one set (kills drift). UI: Import button now lights for ESV bundles; result log shows **"created — pending apply"** + an apply-coming hint. Tests: write/execute/client/parse/kinds/app (+17 → **668**). `/check all` green; build clean.
- **ESV import — Slice 2: apply ✅** — `src/paic/client.ts` `getStartupStatus` (`GET /environment/startup` → `restartStatus`) + `applyEsvUpdates` (`POST /environment/startup?_action=restart`), ESV api version, caps-guard throw. `src/import/apply.ts` `runEsvApply` (client-injected, testable) — initiate (skip POST if already `restarting`), **POST-not-retried → re-GET before failing**, poll until `ready`/timeout tolerating **consecutive** errors (reset on success; a re-mint failing against the restarting runtime is one tolerated error), injected `sleep`/`now`/`onProgress`. Panel `handleApplyEsv` — tenant-wide confirm modal + `withProgress` + streams `applyProgress`/`applyResult` (host-keyed). App: a separate **"Apply ESV changes" button** (after an ESV import) + an independent `apply` state that **survives a realm change** (host-keyed, reset only on connection change) + durable in-UI progress ("Applying… (Ns)" → "✓ ESV changes applied (Ns)"). Tests: `apply.test.ts` (8 — ready/already-restarting/POST-started-anyway/POST-failed/error-tolerance/timeout/progress), client (+4), app (+3 incl. realm-change-survives), messages-guard (+3). `/check all` green (**686 tests**, +18); build clean.

> **Batch 2 ESV import complete** — create-only writes (variable from bundle / secret prompted) + the separate tenant-wide apply (restart) with durable progress.
- **Script/lib import — write path ✅** (2026-06-12) — works end-to-end through the **existing flat verdict-list UI** (no UI changes; the TD-8 grid is a separate task). `src/import/write.ts` `scriptBodyToWire` (inverse of `serialize.ts:scriptBodyToExport` — `JSON.parse`→base64) + `toScriptWrite` (keep `_id`/`name`/`language`/`context` ("LIBRARY" round-trips), drop server-audit fields, re-encode body; non-string body left untouched). `src/paic/client.ts` `writeScript(realm,id,body)` — UUID-preserving `PUT …/scripts/<uuid>`, `SCRIPT_API_VERSION`, 201→created/200→overwritten (mirrors `writeSocialIdp`; body never logged). `execute.ts` `case "script"` (+ `writeScript` in the `ExecuteClient` Pick) — no secret prompt (body is in the bundle, like `variable`). `kinds.ts` `WRITABLE_KINDS` += `script` (lights up the Import button). **Compare (TD-4):** decision scripts **value-compare** (`compare.ts` per-object branch on `context !== "LIBRARY"`; `canonScriptBody` reduces bundle's JSON-stringified body + target's base64 to the same plain source; script diff-mask `description`/`default` dropped) — **library scripts stay existence-only**. Tests: write/execute/compare/client/kinds/preflight + shared fake + transfer App (updated 2 obsolete assertions: script no longer deferred). `/check all` green (**705 tests**, +19); build clean.
  - **Known limitation (being fixed in the next slice — TD-9):** pre-flight matches the target by **name** but the write addresses by the bundle **UUID** — if the target has a same-named script with a different UUID, compare judges one entity while the write creates/overwrites another (AM allows duplicate names). See `docs/lessons.md` (2026-06-12).
- **Script/lib import — closure discovery + write reconcile ✅ (TD-9)** — adopts the **identity model** (UUID in-env, **name cross-env** for scripts) and acts on it. (1) **Closure discovery** — `src/import/discover.ts` (new, pure) `discoverScriptDeps` runs `extractScriptBodyRefs` (D20) on each bundle script's own body → deduped direct `require()` libs + `esv.*` refs; `preflight.ts:discoverDeps` existence-checks them on the target (libs by name via `findRawScriptsByName`; ESVs against the tenant variable+secret lists fetched **once**, mirroring `walk.ts:ensureEsvIndex`). **Bundle-only, depth-1, info-only** — no source conn, no phone-home; a missing lib is name-terminal (no `lib→lib` recursion). Rendered in a read-only **"Requires (must exist on target)"** subsection (`App.tsx:RequiresSection`), honestly labelled (direct refs, not a full closure). (2) **Write reconciliation** — `findRawScriptsByName` (new client method, returns all same-name hits) lets pre-flight stamp `resolvedTargetId` + `targetMatchCount` on the script verdict; `execute.ts case "script"` writes to `item.resolvedTargetId ?? component.id` (overwrite the name-matched target in place; bundle UUID only on true create) — closes the Seam-2 dup-on-import gap. Dup-name (>1 hit) → pick-first + `(N on target)` note. Threaded through `messages.ts` (`preflightResult.requires`) + `panel.ts` (both the run-preflight and post-execute-refresh paths). Tests: discover/preflight/execute/client/app + shared fake (+18 → **723**). `/check all` green; build clean. **Not** the TD-8 grid (still deferred).
  - **Missing-dependency policy = warn, don't block (advisory).** A referenced dep absent on the target is an unmet prerequisite the bundle can't supply; the **confirm modal names the missing deps** (`missingDepsNote`) so the consequence is unmissable, but Import stays enabled (discovery is depth-1/name-based — a false "missing" must not refuse a legitimate import). Hard-block reserved for a future locked-down prod-promotion flow.
  - **Honest limitation (by design):** "Requires" shows **direct** refs only — a present lib's own missing deps don't surface (no body to read; bundle is self-contained, no source conn). Documented as TD-9.
- **Script/lib import — TD-8 Plan-table UI ✅** — replaced the flat verdict list with the locked grid table. `src/webview/transfer/ui/App.tsx` `PlanTable`/`PlanRow` (one CSS grid, `display:contents` rows) — columns **☑ · Action · Type · Status · Name**; Status = text + `transfer-v-*` color (no new icons); Type = codicon + word (`src/webview/transfer/ui/kind-meta.ts`, new, D21-safe — can't import inspector `grouping.ts`); **reactive Action verb** (Create/Overwrite/Skip/Blocked) flips on checkbox toggle; **three row-states** — writable→live default-checked, no-op Identical/Present→disabled+greyed locked Skip, Unsupported/error→no checkbox/Blocked; **type-sorted** (`sortByKindThenName`), name within kind; divider rows dropped. **Selection flow:** `selectedKeys` state seeded to writable verdicts on each preflight (re-seeds on post-execute refresh; cleared on target change), threaded via the `execute` W2E message's new `selected: string[]`; `panel.ts:handleExecute` filters its write items by the selected set (fresh-preflight re-validation + single-confirm modal unchanged). **One batch button** summarizes `Import N selected · X create · Y overwrite` (disabled at 0). `(N on target)` dup-name note in the Name column. Tests: app (table headers, default-check + reactive verb, differs→Overwrite, no-op disabled, unsupported no-checkbox, mixed-count button, selected-threading, kind-then-name sort) + messages (+9 → **732**). `/check all` green; build clean.

- **Script/lib import — TD-10 table semantics ✅** (refines TD-8 per user walkthrough) — deps **folded into the table** (info-only rows: no checkbox, Status Missing/Present) — the separate "Requires" section removed. **No Action column**: a single **three-phase Status** column tells the whole story — **before** (New/Differs/Identical/Present/Missing) → **selected** (checked actionable row shows the pending verb New→`Create` / Differs→`Overwrite`, reverts on uncheck) → **after** (per-row outcome Created/Overwritten/Skipped/Failed) — folding in the old `ExecuteLog`. **Selection is opt-in** (default none) with a tri-state **select-all** header checkbox over actionable rows. **After a completed import the whole table LOCKS read-only** (checkboxes + Import button disabled, a "this plan is now read-only" note) until re-armed by a fresh pre-flight (re-select target / new bundle); `panel.ts:handleExecute` keeps the post-run drift check extension-side only (no re-post). Columns: ☑ · Type · Status · Name. Helpers: `beforeStatus`/`selectedStatus`/`afterStatus`/`pickStatus` in `App.tsx`. Mapping table + rules locked in design-plan.md TD-10. Tests updated (three-phase status, opt-in, select-all, lock-after-import). `/check all` green (**732**); build clean.

- **Script/lib import — create-path UUID-collision guard ✅** (TD-9 corollary, commit `bcd684e`) — a create (no name match) fell back to writing the bundle UUID, which AM's PUT-by-id would silently overwrite if a **differently-named** script already held that UUID (rename-after-copy). Pre-flight now checks the create path (`scriptIdCollision` → `getRawScript(realm, bundleId)`): 404 → safe, stays `new`; 200 → distinct **`id-collision`** verdict (blocked, non-selectable, names the occupant). Never silently overwrites, never re-mints (UUID stability is the point). `compare.ts` (status + ComponentStatus), `preflight.ts` (`getRawScript` on PreflightClient + check), `App.tsx` (blocked row, "ID collision" + occupant in Name). Tests +3. `/check all` green (**735**).
- **Script/lib import — TD-11 overwrite-evidence affordances ✅** — a **Review** column (☑ · Type · Status · Name · **Review**) on `differs` rows, two read-only inspection buttons (live even when the table is locked). **⇆ Diff** (scripts only) — `vscode.diff`: left = live target at `resolvedTargetId` via `paic-script://`, right = bundle component source via the new **`PaicBundleContentProvider`** (`paic-bundle://`, `src/providers/bundle-content-provider.ts`, the only net-new piece); both `.js`. **🔍 Find usages** (scripts + theme/email/idp; variable/secret→esv but never differ) — `searchFactory.spawn({ prefill: { mode:"findUsages", targetKey, targetKind } })`, auto-runs against the target; RealmIndex build stays the Search page's own affordance. Wiring: `canonScriptBody` exported from `compare.ts`; two W2E messages (`openDiff`/`openFindUsages`) + `panel.ts handleOpenDiff`/find-usages handler; `SearchFactory` + the bundle provider injected into `TransferFactory` (structural `SearchSpawner` type to avoid a cross-webview import); UI `reviewFor`/`toEntityKind` + the Review column/buttons. Posture: inform, don't auto-fix. Locked in design-plan.md TD-11. Tests: bundle-content-provider (4), `canonScriptBody` unit, app Review-column (both buttons on script differs / usages-only on theme differs / none on new+identical / live-when-locked) + messages guard (+10 → **745**). `/check all` green; build clean.
  - **TD-11 follow-up fixes (2026-06-13):** (1) **Find-usages key** — use the **target's** id (`resolvedTargetId ?? v.id`), not the bundle id, so the prefill `targetKey` matches the RealmIndex (keyed by target ids). (2) **Search prefill re-seed** — added a `useEffect` in `search/ui/App.tsx` that re-applies `payload.prefill` (mode/Kind/Target/namePattern) + re-arms the one-shot auto-run whenever the prefill changes; `useState` initializers only run on first mount, so re-spawning Find-usages into an **already-open** Search tab previously kept stale/empty Kind+Target. (3) **Index timestamp** — `toLocaleTimeString` → `toLocaleString` (date + time, not just time). Tests: search app (seeds-from-prefill, re-seeds-on-respawn) (+2 → **747**). `/check all` green.
  - **Full-component index enumeration ✅ (2026-06-13, D36 upgrade)** — the RealmIndex now covers **every** component in a realm, not just journey-referenced ones. `client.listScripts(realm)` (`GET …/scripts?_queryFilter=true` — 1164 on sb3, **bodies included** so the closure walk is in-memory) + `client.listEmailTemplates()` (`GET /openidm/config?_queryFilter=true` filtered to `emailTemplate/*` — 81 on sb3; the "no list endpoint" blocker was false). Two best-effort, isolated `build.ts` phases. `scanAllScripts` lists every script (bodies included) + builds ALL script→lib/esv edges in-memory — it **replaced** the old journey-closure BFS (`scanScripts`/`fetchScript` deleted; no more per-script `getScript` / per-lib `getScriptByName`); journey→script edges still come from the journey scan, and the "scripts" phase now reports determinate X/Y over the full list. `scanAllEmailTemplates` adds leaf entities. **Fewer HTTP calls than before** (one list call vs the BFS's per-script + per-lib fetches). Live-verified on sb3: 1164 scripts · 521 require() · 886 esv · 1144 journey-node edges, all without the BFS. Zero model/query/UI changes (consumers already handled zero-inbound entities); orphan scripts open their card via `spawnByDescriptor`, and an orphan referencing an esv shows as `orphanRoot` in find-usages (excluded from `usageCount`). **Unused** is now a true tenant-wide dead-code detector. Non-regressive (best-effort degrades to the prior index on failure). Endpoints + methods live-verified end-to-end through the real client on sb3. Tests: client (listScripts/listEmailTemplates, +2), build (orphan scripts + require edge / Unused / orphanRoot integration / email templates / best-effort, +5) → **754**. `/check all` green.

> **Script import COMPLETE (engine + table + review)** — write · compare (decision value-compare / library existence-only) · closure discovery (direct lib+ESV refs, existence-checked) · write-reconcile to name-matched target UUID · create-path UUID-collision guard · missing-dep modal warning · TD-8/TD-10 three-phase grid table (opt-in selection + select-all, deps folded in, lock-after-import) · TD-11 Review column (Diff + Find-usages on overwrite rows). The Transfer page imports scripts end-to-end through the designed table UI, with overwrite-evidence affordances. **Remaining (whole feature):** journey import (Batch 3 — needs the structural-wiring POC).

**Batch 3 — journey / inner-journey import + cross-lifecycle upgrades** ⏳ — **design locked**: `docs/journey-import-model.md` (PD-1..PD-17) + **D45**. Structural constraints proven (TD-12 inner-journey HARD · TD-13 script name-unique) and prior-art-validated (`poc/prior-art/`). The ordered structural write **plus** the wider base→apply upgrades the investigation surfaced. Sequenced for dev:

*De-risk POCs (do first):*
- [x] **TD-12** — inner-journey-missing = HARD (AM `400`, both deployments) · `inner-journey-dangling-probe.mjs`
- [x] **TD-13** — scripts name-unique per realm (`409`); UUID = identifier, name = cross-env match key · `script-dup-name-probe.mjs`
- [x] **POC — node-type catalog ✅ (TD-14, 2026-06-14)** — read-only `POST nodes?_action=getAllTypes` works both envs (200); **PAIC 234 types · on-prem 116 · 108 shared** (126 PAIC-only cloud/marketplace nodes, 8 legacy on-prem-only). Gate is real & load-bearing (a PAIC `PingOneVerifyNode` journey HARD-fails into bare on-prem). The catalog read = the `getNodeTypes` client method → folds into S1.
- [x] **POC — export→import round-trip ✅ (TD-15, 2026-06-14)** — wrote our **own** allLevels export (`zzz_export_test.journey_all.json`) back into a clean sb2x/alpha via the ordered algorithm → **PASS, a fully wired journey with ZERO field-stripping**. Every node/tree PUT 201 first-try; **AM accepts the raw export shape as-is** (tolerates `_type`/`_outcomes`/`_id` on nodes + the full tree object; only `_rev` dropped). Readback: both trees wired, entry nodes match. Ordering (inner-before-outer, scripts-before-nodes) confirmed end-to-end. Self-cleaned (verified clean). ⇒ executor needs **no routine strip pass**; **G2 strip-and-retry confirmed a SAFETY NET** (edge cases only) → stays deferred to S6. Create-path only; overwrite + name-collision remap (TD-13) exercised later in S5/S6.

*T0 — base-layer fix (independent; fixes a shipping latent bug):*
- [x] **Actionable errors — G1 ✅ (PD-14, 2026-06-14)** — `PaicError.from` now parses the **AM/IDM REST envelope** (`{code, reason, message, detail}`) alongside the OAuth envelope: `description = error_description ?? message` (**OAuth wins** → `auth.ts` scope-fallback untouched), so import/write failures surface the real AM message instead of "Request failed with status code N". New `PaicError.detail` field carries `validAttributes` (readies G2). Companion: the ESV-secret TOCTOU handler regex made wording-tolerant (`/already exist/i`) — it was effectively dead in prod (only fired on a hand-injected shape) and now fires on real AM/IDM bodies. Tests: `errors.test.ts` +3 (AM 400 + detail · AM 409 · OAuth-wins-over-AM). `/check all` green (**769 tests**, +3); build clean.
  - **G2 (`Invalid attribute specified` strip-and-retry) deferred to S6** — it belongs in the node/tree write path (doesn't exist until the executor; leaf writes rarely hit it). The `detail` field added now makes it a drop-in.

*Meta cleanup (PD-18 — meta is non-load-bearing; the import derives 100% from tree structure, the source of truth):*
- [x] **S0 — strip derived journey-export meta fields ✅ (PD-18, 2026-06-14)** — `ExportMeta` (`serialize.ts`) narrowed to provenance + informational `depthMode`; dropped `requires` / `treesSelectedForExport` / `innerTreesIncluded`. `journey-bundle.ts`: removed the now-dead `esvs`/`nodeTypes` accumulation (`AssembledTree` + `assembleTree` + `buildJourneyBundle`; **kept** `innerJourneys` for the allLevels BFS + `extractScriptBodyRefs` for transitive libs); emitted `meta` = `buildExportMeta(...)` + `depthMode` only. (The `parse.ts` display tidy + `parse.test.ts` PD-18 lock landed earlier.) Tests: `journey-bundle.test.ts` 2 tests now assert **content** (level1 → inner not in `trees`; allLevels → inner bundled) + `meta` has no derived fields. `/check all` green (**769 tests**); build clean. ⇒ a journey export's `meta` is now pure provenance; import unaffected (PD-18 — never read it).

*Slice 1 — client + parse foundation:*
- [x] **S1 — client methods ✅ (2026-06-14)** — `src/paic/client.ts`: `writeNode` (`PUT …/nodes/<type>/<id>`) + `writeTree` (`PUT …/trees/<id>`) — both `TREE_API_VERSION`, 201→created/200→overwritten, no caps guard (AM-native), bodies unlogged; `listTrees` (`GET …/trees?_queryFilter=true` → `RawJourney[]`, for the inner-journey existence gate) + `getNodeTypes` (`POST …/nodes?_action=getAllTypes` → `string[]` type ids, for the node-type gate). **No `getRawTree`** — reuses the existing `getRawJourney` for single-tree fetch. Fake (`tests/views/fakes.ts`) gains the 4 stubs (kept type-complete). Tests: `client.test.ts` +6 (URL/version/outcome per method; `getNodeTypes` drops id-less entries). `/check all` green (**775 tests**, +6); build clean. Endpoints/shapes match TD-14/TD-15.
- [x] **S2 — journey bundle decomposition ✅ (2026-06-14)** — `parse.ts:summarizeJourney` now fills `rawComponents`: one **journey unit** per tree (`{ kind:"journey", id, raw:{ tree, nodes, innerNodes } }` — nodes folded in, PD-3; **no** `node`-kind components) + **deduped** shared leaves (script/theme/emailTemplate/socialIdp across trees by `${kind}:${id}`, PD-6) via a `TREE_LEAF_MAPS` table reusing `leafDisplayName`. Content-derived preview line: *"References inner journeys (must exist on target): …"* from `InnerTreeEvaluatorNode.tree` refs minus bundled trees (PD-18). ESV/lib discovery comes free downstream — the existing `discoverScriptDeps` runs over the journey's script components at preflight. Tests: `parse.test.ts` +3 (decompose/fold · dedup · references-inner-journeys) + updated the obsolete "empty for journey" test. `/check all` green (**778 tests**, +3); build clean. **Inert until S3** (UI gates journey preflight). *Scope note: node-type/ESV preview detail folds into S3's gates (computed against the target).*

*Slice 2 — preflight gates + reconcile:*
- [x] **S3 — preflight gates (PD-7) ✅ (2026-06-14)** — the gate **engine** (not yet UI-wired). `discover.ts`: `discoverJourneyRefs(rawComponents)` → `{ nodeTypes, innerJourneys }` (node `_type._id` + `InnerTreeEvaluatorNode.tree` minus bundled) — **shared** with the S2 preview (`parse.ts` refactored to use it). `preflight.ts`: `RequiredDepVerdict` gains `kind: nodeType|innerJourney` + `severity?: blocking|advisory` (absent ⇒ advisory); `PreflightClient` += `getNodeTypes`/`listTrees`; `discoverDeps` tags `advisory`; new `checkJourneyGates(client, realm, rawComponents)` → node-type (vs the `getNodeTypes` catalog, TD-14) + inner-journey (vs `listTrees`, TD-12) **blocking** verdicts (present + missing), each fetch try/caught → **skip-on-failure** (no spurious block); `missingDepsNote` now advisory-only. Tests: discover +3, preflight +5 (+3 `discoverDeps` `toEqual` gain `severity:"advisory"`). `/check all` green (**786 tests**, +8); build clean. **Engine-only — panel wiring + `depRowData` rendering + Import-disable on blocking severity → S8.**
- [x] **S4 — name-reconcile + UUID remap (PD-8/PD-12) ✅ (2026-06-14)** — new pure `src/import/remap.ts`: `buildScriptRemap(scripts)` → **differing-only** `bundleUUID→targetUUID` map (`id→resolvedTargetId` iff set & differs; create / same-UUID → no entry); `remapNodeScript(node, remap)` rewrites `node.script` (else returns the node unchanged); `assertScriptRefsResolved(node, remap)` **throws** if a source UUID survives (PD-12 guard — catches a missed remap before it becomes a dangling write). Scope = the `node.script` UUID attribute only (inner-tree names + `require()` text are never remapped, TD-13 §6). Structural `{id, resolvedTargetId?}` input → no `ComponentVerdict` coupling. Tests: `remap.test.ts` (9). `/check all` green (**795 tests**, +9); build clean. **Engine-only — the S6 executor wires it (build entries from script verdicts → remap each node → assert → write in dependency order).**
- [x] **S5 — journey/node/tree verdicts + inner-journey unit (PD-3/4/5/6) ✅ (2026-06-14)** — the journey **compare + decision layer**. `preflight.ts`: `fetchTarget` journey branch now really fetches (`getRawJourney`, **404→null** since it throws on 404 — else a missing tree reads `error` not `new`); `getRawJourney` added to `PreflightClient`. `compare.ts`: explicit `journey → "exists"` branch (was a fragile `!VALUE_COMPARED` fall-through) — **existence-only, never value-diffed** (cross-env script UUIDs make a raw node diff meaningless; PD-5 drives off existence + role). `discover.ts`: `JourneyRefs` gains `referencedInnerTrees` (all `InnerTreeEvaluatorNode.tree` refs, superset of `innerJourneys`) — reuses the single node-walk; the structural subject/inner split (PD-18). New pure `journey-plan.ts`: `planJourneyUnits(rawComponents, verdictById)` → `JourneyUnitPlan[]` implementing the PD-5 matrix (subject: new→Create / exists→Overwrite; inner: new→Create / exists→**Keep** default + Overwrite allowed). Decoupled `Map` input (mirrors S4). Tests: journey-plan +6 (4 quadrants · role classification · leaf→[]), preflight +2 (exists · 404→new), compare +1, discover assertions. `/check all` green (**804 tests**, +9); both bundles build clean. **Engine-only — S6 orders writes from it, S8 renders rows; `journey` still out of `WRITABLE_KINDS`. `dedup/union`: leaf dedup done in S2; the *need-union* (a shared ref drops when every referencing journey is Keep'd) depends on user choices → lands in S6/S8.**

*Slice 3 — executor + freeze:*
- **S6 — dependency-ordered executor (PD-13/PD-15) + G2 strip-and-retry** — *split into S6a (per-unit writer) + S6b (orchestrator) by user choice.*
  - [x] **S6a — journey-unit writer ✅ (2026-06-14)** — new pure `src/import/journey-write.ts`: `writeJourneyUnit(client, realm, unit, scriptRemap)` writes one unit's nodes (page-children then top-level) **then** its tree as **update-in-place PUTs** (PD-13). Per node: `remapNodeScript` (S4) → `assertScriptRefsResolved` (S4/**PD-12**, throws → node-failure) → `writeNode`. **PD-15 (local):** any node fails → **tree not written**, unit `failed` (message names the node). **G2 safety net** (`putWithRetry` + `stripInvalidAttributes`, mirrors frodo `JourneyOps.ts:2082`): on `400 "Invalid attribute specified."` with `detail.validAttributes`, keep those + `_id`, drop the rest, **retry once** — both node + tree PUTs. Nodes/tree written **raw-as-is** (TD-15; `_rev`/audit already stripped at export → no 412). Returns one `WriteResult` (`kind:"journey"`); structural `JourneyWriteUnit {id,displayName,raw}` + `Map` input (no `ImportComponent`/`JourneyUnitPlan` coupling). Tests: `journey-write.test.ts` (7) — nodes-then-tree · remap-before-write · PD-12 chained-survivor · PD-15 node-fail-skips-tree · G2 strip+retry · G2-negative (non-G2 400) · malformed node. `/check all` green (**811 tests**, +7); build clean. **Engine-only — S6b wires it.**
  - [x] **S6b — orchestrator ✅ (2026-06-14)** — new pure `src/import/journey-execute.ts`: `runJourneyExecute(client, realm, plan)` writes **all leaves first** (reuses the public `execute.ts:runExecute` — scripts before the nodes that ref them; no need to export `writeOne`) **then journeys inner-before-outer**. Topo order via DFS post-order over a per-unit dep graph (`depGraph` = `innerTreeRefs(raw) ∩ written-unit-ids`, minus self; `onPath` guard survives degenerate cycles). **Cross-journey dependency-aware skip (PD-15 cross half):** a `failed` set holds units that failed *or* were skipped; a unit with a blocked dep → `skipped` `prerequisite "<dep>" failed` + added to the set → **transitive**. `JourneyImportPlan {leaves, journeys (Create/Overwrite only), scriptRemap}`; returns `WriteResult[]` in write order (UI re-sorts). A failed **leaf** needs no special case — its dependent node fails in `writeJourneyUnit` → unit failed → dependents skip (automatic cascade). `discover.ts`: added `innerTreeRefs(raw)` (per-unit inner-tree refs). Tests: journey-execute +7 (leaves-first · topo · nested topo `DeviceCheck,MFA,Login` · PD-15 skip · transitive skip · failed-leaf-doesn't-block · empty), discover +2 (`innerTreeRefs`). `/check all` green (**820 tests**, +9); build clean. **Engine-only — S8 assembles the plan (filter Keep, map S5 plans → `JourneyWriteUnit`, `buildScriptRemap`), adds `journey` to `WRITABLE_KINDS`, renders results.**
  - **⇒ S6 complete: the engine can import a journey end-to-end** (leaves → remap → ordered node/tree writes → dependency-aware skip → per-item results). Remaining before it's user-reachable: S7 (freeze-the-plan) + S8 (UI wiring).
- [x] **S7 — freeze-the-plan (PD-11) ✅ (2026-06-14)** — new pure `src/import/freeze.ts` closes the preview→commit TOCTOU. `FrozenPlan` (readonly): `{realm, targetKind, rawComponents, plan: JourneyImportPlan, snapshot}` — the immutable saved-plan (executed verbatim) + the preview target snapshot. `snapshotState(verdicts, gates)` → `Map` keyed `${kind}:${id}` per component (leaves + journeys) + `${kind}:${name}` per **blocking** gate (advisory libs/ESVs dropped — they never gated import); one keying function for both freeze + commit. `diffSnapshots(was, now)` → `DriftItem[]` (changed/added/removed; absent side `"(absent)"`). `detectDrift(client, frozen)` re-runs `runPreflight` + `checkJourneyGates`, rebuilds the snapshot, diffs → `DriftReport` (empty ⇒ safe to apply; non-empty ⇒ caller forces re-plan). **Verdict-granularity** drift (catches `new→exists`/`exists→new`/`identical↔differs`/gate `present↔missing`; `differs→differs` not flagged — Overwrite wins per PD-13, Create stays `new`/safe). **Remap drift covered free** (a name-matched script's verdict shifts → re-plan rebuilds the remap). Reuses the whole preflight stack — no new fetch machinery. Tests: `freeze.test.ts` (6) — snapshotState keying/advisory-drop · diffSnapshots clean+changed/added/removed · detectDrift clean · component `new→exists` · blocking-gate `present→missing`. `/check all` green (**826 tests**, +6); build clean. **Engine-only — S8 freezes at preview, calls `detectDrift` on Import → drift forces re-plan, else `runJourneyExecute(frozen.plan)`.**

*Slice 4 — UI:*
- **S8 — journey import UI** — *split into S8a (panel + protocol) + S8b (React UI) by user choice (layer split).*
  - [x] **S8a — panel wiring + message protocol ✅ (2026-06-14)** — the extension half: journey import now runs end-to-end from the panel (UI still leaf-only until S8b). New pure `src/import/journey-assemble.ts`: `assembleJourneyImport(input)` → `{ plan: JourneyImportPlan, blockingMissing, counts }` — filters selected/writable/New-Differs **leaves** → `WritePlanItem[]`, resolves each journey's action (override **clamped to `allowedActions`**, e.g. a subject can't be Kept; **Keep dropped**) → `JourneyWriteUnit[]`, builds the script remap (S4), lists missing **blocking** gates, and counts create/overwrite/keep. `messages.ts`: `preflightResult` += `journeyPlans`; `execute` += `journeyActions`; new `driftDetected` E2W (+ `isE2W`); re-exports `JourneyUnitPlan`/`JourneyAction`/`JourneyRole`/`DriftItem` for the sandbox. `panel.ts` (thin glue): `handleRunPreflight` also runs `checkJourneyGates` (merged into `requires`) + `planJourneyUnits`, and **stores the preview snapshot** (`snapshotState`, PD-11); new `executeJourneyImport` branch — fresh re-read → **drift check** (`diffSnapshots` vs the stored baseline → `driftDetected`, no write) → blocking-gate guard → `assembleJourneyImport` → confirm (create/overwrite/keep counts, "not transactional") → `collectSecrets` (extracted, shared with the leaf path) → `runJourneyExecute`. **`WRITABLE_KINDS` left unflipped** (journey path branches on `bundle.kind`; UI ignores the new optional fields → no half-built state). Tests: `journey-assemble.test.ts` (8) + `messages.test.ts` (driftDetected guard). `/check all` green (**834 tests**, +8); both bundles build clean. *Panel is untested glue as before — the logic lives in the pure, tested `journey-assemble` + reused S4/S6/S7 primitives.*
  - [x] **S8b — React UI ✅ (2026-06-14)** — **journey import is now user-reachable end-to-end.** `kinds.ts`: `WRITABLE_KINDS += "journey"` (flips the UI's `isWritable`). `App.tsx`: journeys flow through the existing Target + Plan sections (removed the "later batch" deferral + `!isJourney` gates; pre-flight runs for journeys). The decision model renders on the **existing grid** by reusing the checkbox column: a **subject** → a header line (*"Import journey: Login — Overwrite (exists) → host/realm"*, PD-2); an **exists inner** → checkbox = **Overwrite (checked) / Keep (unchecked, default)**; a **new inner** → a `"forced"` row (checked+disabled "Create"); **bundled leaves** → existing verdict rows but **seeded checked** for journey bundles (the journey needs its scripts) vs opt-in-off for leaf bundles. **Severity gate:** blocking-missing gates render `Missing ⛔` + a banner and **disable Import** (`depRowData` now maps nodeType/innerJourney kinds too). `onExecute` sends `journeyActions` (exists-inner checked→overwrite else keep; new/subject use engine defaults). `driftDetected` → re-run pre-flight (PD-11 re-plan). Helpers: `journeyActionFor`, `journeyButtonLabel`, `journeyRowData`. CSS: `.transfer-subject`. Tests: `app.test.tsx` +6 (subject header + inner row · exists-inner Keep→Overwrite toggle · new-inner forced Create · blocking-gate ⛔ disables Import · Import posts `journeyActions`+seeded leaf keys · `driftDetected` re-plans) + rewrote the deferral test; updated `selectTargetAndPreflight`/posts for the required `journeyPlans` field. `/check all` green (**840 tests**, +6); all four webview bundles + extension build clean (`out/transfer.js` 290kb). Leaf-bundle behavior unchanged (branches key off `journeyPlans.length`). **⇒ S8 complete — the full S1–S8 stack runs through the UI.**
  - **Status-vocab audit (2026-06-14):** journey rows reuse the leaf words/CSS exactly — `Create`/`Overwrite` (verbs, `transfer-v-ok`/`-diff`), `afterStatus` → `Created`/`Overwritten`/`Skipped`/`Failed`, `Present`/`Missing ⛔`; `Keep` is the one intentional new word (PD-5, no leaf equivalent). Subject header aligned to the model format `Import journey: <name> → host/realm (⚠ exists → Overwrite | new → Create)`. *Intended differences (kept):* journey rows show the decision verb directly (no comparison-noun phase-1 — an exists-inner reads `Keep`, not `Present`) per the model's separate inner-journey vocab.
  - **Deferred to S9 (polish):** count-summary header · per-row reason text · blast-radius/find-usages on journey rows · dedicated ⇄ toggle (vs checkbox-reuse) · **advisory `Missing ⚠`** (today plain `Missing` — matches existing leaf behavior; the model wants `⚠`, and it also touches leaf rows so it's batched here).
> **Plan-system parity note (2026-06-14).** Batch 3 upgraded the *whole* plan system, not just journeys. Audit of leaf/script vs journey paths: **already shared** — G1/PD-14 error envelope (transport-layer). **N/A for leaves** — PD-13 in-place PUT, PD-15 dependency skip (leaves are independent single PUTs), blocking gate (leaves have `id-collision`). **Genuine leaf gaps to backport** — **PD-11** freeze→drift-refuse (leaf path only `warnOnDrift`, logs-not-stops) + **G2** strip-and-retry. *(Both done in S10b. Correction: G2 turned out AM-config-endpoint-specific — only the `socialIdp` leaf kind can hit it, not a broad gap.)* The leaf path is *not unsafe* (it re-validates with a fresh pre-flight before writing) — this is consistency/UX parity. The S9–S12 items below are therefore scoped **whole-plan (leaf + journey)**, and the apply-lifecycle parity lands in S10.
>
> **Apply-lifecycle re-audit (confirm → progress → report).** The journey path did **not** ship a new progress or report system — it reuses the leaf surfaces. Today: **confirm** = both paths (shared `confirm()` helper; only the count vocabulary differs — leaf `create/overwrite`, journey `create/overwrite/keep`); **progress** = both **indeterminate** at audit time (determinate PD-16 since built cross-kind in **S10a ✅**); **result** = both the shared one-line `executeResult.summary`; **JSON report** = **neither** (PD-17 unbuilt → S11). ⇒ confirm/progress/report are already consistent; the *only* lifecycle divergence is freeze/drift (→ S10). The determinate-progress + JSON-report upgrades are built cross-kind, so they stay consistent by construction.

- **S9 — UI polish, whole-plan (leaf + journey)** — *split into S9a (text/header polish) + S9b (blast-radius) by user choice.*
  - [x] **S9a — count line + smart-default + advisory ⚠ + reasons + confirm unify ✅ (2026-06-14)** — **Smart-default selection unified** (decision confirmed: adopt-for-leaves): the `preflightResult` handler now seeds `selectedKeys` with every writable leaf key for **both** leaf and journey bundles (was opt-in/default-off for leaves, TD-10) — recommended actions arrive pre-checked, user can deselect. **Count-summary line** above the table (`planSummaryLine` → `Plan: N create · M overwrite · K keep · U unchanged · B blocked`, zero buckets omitted); **post-import the same slot renders `execute.summary`** — which was computed + posted but **never rendered** (latent gap, now fixed). **Advisory `Missing ⚠`** (`depRowData`; blocking stays `Missing ⛔`). **Light per-row reasons** on dep/gate rows (`depReason`: nodeType→"not installed…", innerJourney→"…import it first", lib/esv→"referenced by a bundled script…"). **Unified confirm wording**: new pure `src/import/confirm.ts` `buildImportConfirmDetail()` (one count vocabulary, `keep` omitted when 0) — both leaf + journey panel paths call it. CSS `.transfer-plan-summary`. Tests: `confirm.test.ts` (4) + `app.test.tsx` +3 (smart-default pre-check · count line pre/post-import · blocking-gate reason) and **9 re-baselined** to default-on. `/check all` green (**847 tests**, +7); build clean. *Shipped-behavior change: leaf rows now arrive pre-checked.*
  - [ ] **S9b — blast-radius usage badge + cross-import find-usages — ⏸ DEFERRED (2026-06-14, user choice)** — find-usages already works via the per-row buttons (TD-11), so no capability is lost; the inline "used by N" badge needs the realm-index (`realmIndexCache` + `findUsagePaths`) wired into the transfer panel — and building that index is a deliberate ~10s user-explicit walk (D36), so the badge would often be empty unless built-on-demand (heavier). Lower value than the lifecycle work → **backlog**; revisit after S10–S12.

*Slice 5 — apply lifecycle (whole-plan; unify leaf + journey):*
- **S10 — determinate progress (PD-16) + apply-lifecycle parity** — *split into S10a (progress) + S10b (leaf freeze/drift + G2 parity).*
  - [x] **S10a — determinate progress (PD-16) ✅ (2026-06-14)** — both import paths now show a **determinate** bar + **live row updates**. New `onResult?(r)` callback threaded through `runExecute` (after each `writeOne`) and `runJourneyExecute` (leaves + every journey unit, incl. skipped) — fires in deterministic write order. New E2W `executeProgress {result, done, total}` (+ `isE2W`). `panel.ts`: both paths run under a determinate `withProgress` whose `onResult` calls `progress.report({increment, message: "<kind> <name> (k/total)"})` **and** posts `executeProgress`; the final `executeResult` stays authoritative. `App.tsx`: `ExecuteState.running` accumulates results + `done`/`total`; rows flip to their outcome **live** (resultByKey from running results), checkboxes **frozen** during the write (`frozen = locked || running`), summary slot shows `Importing… k/total`. Tests: execute +1 (onResult order), journey-execute +1 (onResult incl. skipped), messages +1 (guard), app +1 (live flip + running count). `/check all` green (**850 tests**, +3); build clean. Both paths, one mechanism.
  - [x] **S10b — leaf apply-lifecycle parity (PD-11 freeze/drift + G2) ✅ (2026-06-14)** — the apply lifecycle is now **uniform across leaf + journey**. **Freeze/drift-refuse:** the leaf `handleExecute` re-reads fresh (`runPreflight` + `checkJourneyGates` → `[]`) and calls a new shared `panel.driftStops(host, realm, snapshotState(...))` — drift since the stored preview snapshot → `driftDetected` (UI re-plans), **no write** (was `warnOnDrift` log-only). `driftStops` is extracted + reused by `executeJourneyImport` too (DRY). Post-write `warnOnDrift` kept (separate transform-vs-compare diagnostic). **G2:** `putWithRetry`/`stripInvalidAttributes` moved to new pure `src/import/write-retry.ts` (shared); `execute.ts:writeOne` wraps every leaf write in `putWithRetry` (uniform; a no-op for endpoints that never emit the envelope). Tests: `write-retry.test.ts` (5) + `execute.test.ts` +1 (socialIdp G2 retry); `journey-write.test.ts` unchanged (still exercises `putWithRetry` via the import). `/check all` green (**856 tests**, +6); build clean. **Behavior change (confirmed): leaf import refuses-on-drift + re-plans instead of silently logging.** ⇒ **S10 complete.**
  - **Audit correction (2026-06-14):** G2 is **AM-config-endpoint-specific** (authentication-tree nodes/trees + social IdP), not a broad leaf gap — among leaf kinds only **`socialIdp`** can actually return `Invalid attribute specified.` (IDM themes/emails/ESVs and `/scripts` don't). The uniform leaf wrap covers it; the rest are harmless no-ops. (Supersedes the earlier "G2 = journey-write-only broad leaf gap" framing in the parity note.)
- [x] **S11 — JSON result report (PD-17), leaf + journey ✅ (2026-06-14)** — a **Download report** button on the locked result table writes a structured JSON. New pure `src/import/report.ts`: `buildImportReport({host, realm, bundle, startedAt, finishedAt, results, beforeSnapshot})` → `{ meta (+ overallStatus success/partial/failed), summary (created/overwritten/skipped/failed), items[] }`; each item `{type, id, name, action, before: {verdict}|null, message?}` — `before` is the **frozen pre-flight snapshot** verdict (object-shaped so future rollback can add `content` without a format change). `panel.ts`: built **at execute completion** (both paths, via `captureReport`) into `this.lastReport` (reset on new bundle) so the download isn't stale after a re-preview; `handleDownloadReport` = `showSaveDialog` → `fs.writeFile` (mirrors the bundle-load dialog) with native info/error toasts. W2E `downloadReport`. `App.tsx`: the button posts it when `execute.status === "done"`. **No secrets in the report** (kind/id/name/outcome/before-verdict/message only). Tests: `report.test.ts` (4 — items/before-null/summary/overallStatus) + `app.test.tsx` +1 (button shows post-run + posts) + messages guard. `/check all` green (**861 tests**, +5); build clean. *Scope: `before` is verdict-level (content-`before` for rollback = future); `meta.stoppedAt` omitted (attempt-all executor, not a single stop); richer `plan` count block deferred.*
- [x] **S12 — re-plan after partial failure (G4), leaf + journey ✅ (2026-06-14)** — a **Re-plan** button on the locked result table recomputes against the now-changed target (one-click recovery). Pure `App.tsx`: extracted a shared `replan(host, realm)` (`setExecute(idle)` + `setPreflight(running)` + post `runPreflight`) — the `driftDetected` handler now calls it too (DRY); App-level `onReplan` → `PlanSection` renders the button when `locked`. **No engine/panel/message change** — reuses the existing `runPreflight` round-trip; `handleRunPreflight` re-reads + re-stores the freeze snapshot. Because the pre-flight re-reads the live target + S9a re-seeds smart-defaults: succeeded items → Identical (no-op), failures → still New/Differs **pre-checked** → one more Import retries exactly them. Tests: `app.test.tsx` +1 (button shows post-run, posts `runPreflight`, returns to checking). `/check all` green (**862 tests**, +1); build clean. **⇒ Batch-3 in-scope slices complete (T0, S0–S12).**

*Future (planned, on the plan — not this build):*
- [ ] **Quick rollback (PD-17 baseline)** — time-bounded undo; reverse-dependency order; per-item reverse precheck ("still as we left it?"); created→delete (usage-gated), overwritten→restore. JSON report shaped now to support it.

### UX consistency pass (pre-journey-import polish) ✅ (2026-06-13)

- **Combobox reopen-filter fix** — the shared `Combobox` (D38) collapsed the list to the single selected item when reopened (the committed label was reused as the filter). Added a `showAll` flag (set on open, cleared on first keystroke) so reopening lists every option, with select-all-on-focus + revert-abandoned-typing-on-close. New `tests/webview/shared/combobox.test.tsx` (7 — had **no** dedicated coverage before); wired `tests/webview/shared/**` into both tsconfigs.
- **D44 — one prompt surface** — native modal for every decision; `showQuickPick` retired from `src/`. New `src/util/dialogs.ts` (`confirm` / `chooseModal`, both wrap `showWarningMessage({modal:true})`). Converted `removeConnection` (YES/NO QuickPick → modal) + export-depth (QuickPick → 2-button modal); routed the import + ESV-apply confirms through `confirm()`. Exceptions (a modal physically can't): `withProgress`, `showInputBox`. Policy recorded in design-plan.md **D44** + `.claude/rules/conventions.md` ("User prompts"). Tests: `dialogs.test.ts` (5) + export-journey updated to mock `showWarningMessage`; vscode-mock gains `showWarningMessage`/`showInputBox`, drops `showQuickPick`.

---

## What's working today

**Connections (M0)**
- Activity bar icon (`type-hierarchy` tree glyph) opens the PAIC Journeys sidebar.
- Add / Edit / Remove Connection commands; round-trip with JWK in SecretStorage.
- Inline Edit + Remove buttons on each connection row; native modal remove confirmation (D44).
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
- `npm run build` → `out/extension.js` + `out/webview.js` + `out/connection-form.js` + codicons assets.
- `npm run typecheck` covers both `tsconfig.json` and `tsconfig.webview.json`.
- 766 unit tests + 7 gated on-prem live integration tests (`PAIC_LIVE=1`, M8 Slice 5; skipped by default) across PAIC transport (incl. `makeLimiter` + the injected AM context path / capability short-circuit + `am-url` helpers — M8 Slice 3/4), tenant registry + client cache, the auth-strategy seam (`paic`/`onprem` strategies — M8), the kind-split connection form (M8 Slice 4), tree nodes, inspector panel + protocol (incl. `findUsages` dispatch), React card + diagram components (incl. 5 card `[🔍 Find usages]` button cases), resolver walk + cache (M4), realm-index build + cache + queries with progress reporting (M5 Slices 1, 5, 6), the Search webview's messages + panel + App with singleton-page + connection/realm dropdowns + build progress bar (M5 Slices 2–4, 6), and the `InspectorFactory.spawnByDescriptor` refactor.

## What's broken today

(nothing)

## Active blockers

(none)
