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

## M1 — Forward exploration with detail panel ⏳ (current)

**Goal:** pick connection → realm → journey → see scripts + inner-trees as children → select anything → see basic info in a detail panel.

### Structured logger (D9)

- [ ] Add `pino` + `pino-roll` runtime deps
- [ ] `src/util/logger.ts` — pino instance with `pino.multistream([fileStream, channelAdapter])`, `redact` paths for secrets, `base: { service, version }`, `level` from setting
- [ ] Channel adapter: tiny `Writable` that parses NDJSON and routes to `LogOutputChannel.info/warn/error`
- [ ] Settings: `paicJourneys.logging.level`, `paicJourneys.logging.fileEnabled`
- [ ] Migrate ~10 existing `log.info(...)` calls in `extension.ts` + `connection-form.ts` to pino's `log.info({fields}, "msg")` shape with `event` field
- [ ] Verify NDJSON output at `globalStorageUri/logs/paic-journeys.ndjson`

### Transport + domain layers

- [ ] `src/paic/errors.ts` — `PaicError` flattening AxiosError fields
- [ ] `src/paic/realm-path.ts` — `getRealmPath(realm)` (verbatim from frodo)
- [ ] `src/paic/pagination.ts` — `listAllPaged(fetchPage)` helper
- [ ] `src/paic/concurrency.ts` — `mapConcurrent(items, N, fn)` helper (~25 lines) OR `p-limit` import (Q-3)
- [ ] `src/paic/http.ts` — axios instance per connection, retry, 429 Retry-After, error wrap, `X-ForgeRock-TransactionId` header (uses injected logger from above)
- [ ] `src/paic/mappers.ts` — raw PAIC → domain translation (location TBD via Q-1)
- [ ] `src/paic/client.ts` — `PaicClient`: `listRealms`, `listJourneys`, `getJourney`, `getNode`, `getScript`
- [ ] `src/domain/types.ts` (or `models/types.ts` — Q-2) — `Realm`, `Journey`, `Script`, `InnerJourneyRef`, refined `Connection`

### Tenant registry

- [ ] `src/tenants/registry.ts` — extract connection list/persist/secret-handling from `extension.ts`

### Tree view (deeper levels + D12 cutover)

- [ ] `views/nodes/base.ts` — abstract `PaicNode` (class hierarchy lands here, not deferred)
- [ ] `views/nodes/connection.ts` — wraps existing logic
- [ ] `views/nodes/realm.ts`
- [ ] `views/nodes/journey.ts`
- [ ] `views/nodes/script.ts` — leaf
- [ ] `views/nodes/inner-journey.ts` — leaf
- [ ] Lazy `getChildren()` per kind; loading / error states
- [ ] "Refresh" command at each level

### Detail panel (D15 trigger — webview framework lands here)

- [ ] esbuild second entry → `out/webview.js`
- [ ] `src/webview/messages.ts` — typed message protocol (discriminated unions)
- [ ] `src/webview/inspector/` — React panel component, opens beside the editor
- [ ] Tree-selection → `postMessage` with `(kind, id, raw)` → panel renders kind-specific card
- [ ] Cards: Connection / Realm / Journey / Script / InnerJourney — all basic info only, no body / no diagram
- [ ] In-panel links to navigate tree selection (e.g. journey card → click a referenced script → tree selection moves there)
- [ ] VSCode CSS variables only; no component lib

### Tests

- [ ] Unit tests for `paic/auth.ts`, `errors.ts`, `realm-path.ts`, `pagination.ts`, `mappers.ts`, `client.ts`
- [ ] Component smoke tests for the inspector panel against fixture domain objects
- [ ] Captured AIC responses scrubbed of real tenant hostnames / IDs and committed under `tests/fixtures/`

## M2 — Fill the detail panel: real content ⏳

- [ ] Pick M2 script renderer (Q-16): Monaco vs react-syntax-highlighter
- [ ] Wire script-card → render body with picked renderer
- [ ] Add ReactFlow to the bundle; render per-journey node-flow diagram in the journey card
- [ ] Hover tooltips on tree items (Markdown-formatted metadata)
- [ ] Persist tree collapse state to `globalState` keyed by node `uid`
- [ ] "Open in Editor" right-click action on script nodes (opens script body as a regular editor tab — `vscode.workspace.openTextDocument`)

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

- Activity bar globe icon opens the PAIC Journeys sidebar.
- Add / Edit / Remove Connection commands; round-trip with JWK in SecretStorage.
- Inline Edit + Remove buttons on each connection row.
- Non-modal QuickPick confirmation for Remove.
- Test Connection button in the Add/Edit form (live JWT-bearer mint + verification with sb3 — confirmed working).
- All actions log to `PAIC Journeys` OutputChannel.
- `./dev-tail.sh` follows the latest disk log file across reloads.

## What's broken today

(nothing)

## Active blockers

(none)
