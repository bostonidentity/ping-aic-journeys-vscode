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

- [x] `src/resolver/script-body-parser.ts` — `extractScriptBodyRefs(body): { libraryScripts: string[]; esvs: string[] }`. Single regex set: `require('<name>')` (both quote styles, whitespace-tolerant), `&{esv.<NAME>}`, `systemEnv.<NAME>`. Returns deduped + sorted arrays. 9 unit tests cover every form + the dedup paths.
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

#### Other M3 notes / non-goals

- [ ] First-click latency on journey expansion grows (PageNode container walk adds one extra `getNode` per child ref). Needs a live-tenant measurement pass against sb3 to record the actual range — not blocking the M3 commit; will be recorded here once captured.
- **Deferred** to a later milestone: `product-Saml2Node` (SAML2 entities + circles of trust — narrower customer segment, needs two-fetch resolution); `designer-*` custom marketplace nodes (minority of customers).
- **Deferred to M4** per D21: `listEsvs()` for the realm-index scan stays out of the tree's per-expansion path; the RealmIndex owns its own ESV index with its own refresh cycle. M5 back-search will consume that index, not the tree's per-expansion data.

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
