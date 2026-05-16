# Ping AIC Journeys — Progress

> Build status tracker. See [design-plan.md](design-plan.md) for what each phase means.

## Phase 0: POC — connection CRUD ✅

- [x] Repo scaffolded (`gh repo create --public --license mit --gitignore Node`)
- [x] Manifest with one activity bar container, one tree view, three commands, one settings property
- [x] `Connection` type + add/edit/remove via QuickPick chain
- [x] Plaintext fields → `aicJourneys.connections` setting (workspace-if-open else global)
- [x] `saJwk` → `SecretStorage` keyed by `aicJourneys.saJwk.<host>`
- [x] Tree view with `host`/`name` label
- [x] `LogOutputChannel('AIC Journeys', { log: true })` wired into all commands
- [x] `dev-tail.sh` to follow the latest disk log file from a terminal
- [x] esbuild build pipeline (`npm run build`, `npm run watch`)
- [x] Verified end-to-end: add → edit (rename host) → remove all logged correctly

## Phase 1: AIC client + auth ⏳

- [ ] `src/aic/types.ts` — `Tree`, `Node`, `Script`, `Connection`, `CachedToken`
- [ ] `src/aic/auth.ts` — `TokenSource` class (JWT-bearer mint + cache + invalidate)
- [ ] `src/aic/realm-path.ts` — `getRealmPath()` (verbatim from frodo)
- [ ] `src/aic/errors.ts` — `AicError extends Error`
- [ ] `src/aic/http.ts` — `makeClient()` axios instance with header injection + interceptors
- [ ] `src/aic/pagination.ts` — async iterable for `_queryFilter=true`
- [ ] `src/aic/client.ts` — `AicClient`: `listJourneys`, `getTree`, `getNode`, `getScript`, `getScriptByName`
- [ ] `aicJourneys.testConnection` command — mint token, list realms, show ✓/✗
- [ ] Unit tests against axios mocks

## Phase 2: Resolver ⏳

- [ ] `src/resolver/graph.ts` — `DependencyGraph`, `GraphNode`, `GraphEdge` types
- [ ] `src/resolver/walk.ts` — `walkJourney(client, journeyId)` full BFS, cycle-guarded
- [ ] `src/resolver/cache.ts` — per-session memoization keyed by `(kind, id)`
- [ ] ESV regex helpers (`&{esv...}`, `systemEnv.X`)
- [ ] Library-script recursion (port the regex from frodo's `getLibraryScriptNames`)
- [ ] Fixture tests against `poc-journey-export/paic-ui/multiple-journeysExport-*.json`

## Phase 3: Tree view → realms → journeys → deps ⏳

- [ ] `realmsTreeProvider` — fetches realms once per connection
- [ ] `journeysTreeProvider` — `_queryFilter=true` paginated, group by enabled/disabled
- [ ] Per-journey lazy expansion: load tree → emit dep children
- [ ] Loading/error states with icons
- [ ] "Refresh" command at each level

## Phase 4: Graph webview ⏳

- [ ] `webview/ui/` separate esbuild entry point (React + ReactFlow)
- [ ] `postMessage` protocol typed
- [ ] Hierarchical + force layouts toggle
- [ ] Kind filter chips
- [ ] Node detail pane

## Phase 5+: Reverse lookups, orphans, saved graphs

Tracked at design-plan headings; will populate here when started.

---

## What's working today

- Activity bar globe icon opens the AIC Journeys sidebar.
- "Add Connection" prompts for host / saId / name / JWK, persists.
- "Edit Connection" round-trips correctly, including host rename (moves secret to new key).
- "Remove Connection" deletes both metadata and secret.
- All actions log to `AIC Journeys` OutputChannel.
- `./dev-tail.sh` follows the latest disk log file across reloads.

## What's broken today

(nothing yet)

## Active blockers

(none)
