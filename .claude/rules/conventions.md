# Coding Conventions

Rules for writing code in this project. Referenced by the `dev-task` skill and `security-reviewer` agent. Follow these when implementing any task.

## Logging

### When to log

| Event | Level |
|---|---|
| Extension activation (version, log level) | `INFO` |
| Connection add / edit / remove | `INFO` |
| Test Connection success | `INFO` |
| Test Connection failure | `ERROR` |
| Token mint started / completed | `DEBUG` |
| Token cache hit | `TRACE` |
| PAIC HTTP request (method, URL, status) | `DEBUG` |
| PAIC HTTP error (status, body) | `ERROR` |
| Resolver: walking journey | `INFO` |
| Resolver: cache hit | `TRACE` |
| Webview: posting message (type, size) | `DEBUG` |
| Unexpected error (any layer) | `ERROR` |

### Log format

```ts
log.info('context: operation key=value key2=value2');
```

Use `key=value` pairs for structured data. Prefix logs with the component context (`addConnection:`, `resolver:`, `paicHttp:`, `webview:`).

### What level to use

| Level | When | Visible at default log level? |
|---|---|---|
| `ERROR` | Something failed that the user should know about | Yes |
| `WARN` | Something unexpected but recoverable (retry, fallback) | Yes |
| `INFO` | Key lifecycle events (commands fired, requests made, resolves started/finished) | Yes |
| `DEBUG` | Internal details useful while developing (request bodies, cache state) | No (Debug or Trace only) |
| `TRACE` | Per-iteration internals (loop bodies, cache hits) | No (Trace only) |

Rule of thumb: if a user pasted their log into a bug report, would the line help diagnose? Then INFO. If only the developer needs it, DEBUG or TRACE.

### Where to call the logger

| Layer | How to log | Import |
|---|---|---|
| Extension code (`src/extension.ts`, `src/commands/`, `src/views/`) | `log.info()` etc. | `import { log } from './logger'` (or wherever it's exported) |
| PAIC client (`src/paic/*`) | Pass a `Logger` via constructor / params; never call vscode APIs directly | from `src/util/logger.ts` |
| Resolver (`src/resolver/*`) | Same as PAIC client — injected logger | from `src/util/logger.ts` |
| Webview UI (`src/webview/ui/*`) | `console.log` is acceptable; for important events `postMessage({type: 'log', level, msg})` and let the extension log it | n/a |

### What to NEVER log

- JWKs, access tokens, JWT payloads, decoded JWT claims
- Anything retrieved from `SecretStorage`
- Authorization headers in request dumps
- Real customer journey/script/script bodies (those are the user's data, not ours)
- The literal contents of an `Authorization: Bearer ...` header

Logging the host (`openam-tenant.example.forgeblocks.com`) or `saId` is fine.

## Import conventions

- `vscode` imports allowed only in: `src/extension.ts`, `src/commands/*`, `src/views/*`, `src/webview/panel.ts`, `src/tenants/*`, `src/providers/*`, `src/util/logger.ts`, `src/util/dialogs.ts`. **Never** in `src/paic/*` or `src/resolver/*` — those must be pure TypeScript with no editor dependency.
- `axios` allowed only in `src/paic/*`. Other layers go through `PaicClient`.
- `jose` allowed only in `src/paic/auth.ts`.
- React + ReactFlow imports allowed only in `src/webview/ui/*`. Never in extension code.
- Use the `@/` path alias for all imports from `src/`.

## Error handling

- User-facing errors via `vscode.window.showErrorMessage()` — plain language, no codes. ("Couldn't connect to the tenant. Check the host and your service-account credentials.")
- Log-facing errors include the technical message (`token mint failed: 401 invalid_client`).
- Always catch + log in command handlers and async tree-provider methods before re-throwing or surfacing to the user. An uncaught rejection in a command leaves the UI dangling.
- Wrap every PAIC HTTP error in an `PaicError` (`src/paic/errors.ts`). Callers only see `PaicError`, never raw `AxiosError`.

## Naming

- Files: kebab-case (`token-source.ts`, not `tokenSource.ts`) — enforced by biome.
- Functions: camelCase.
- Types/interfaces: PascalCase.
- Constants: UPPER_SNAKE_CASE.
- Settings keys: `paicJourneys.<noun>` or `paicJourneys.<noun>.<sub>`.
- Command IDs: `paicJourneys.<verb><Noun>` (e.g. `paicJourneys.addConnection`).
- Secret keys: `paicJourneys.<purpose>.<host>` (e.g. `paicJourneys.saJwk.openam-...`).
- Settings property defaults to `[]` / `""`, never `null` (matches VS Code's settings schema conventions).

## VS Code Extension API patterns

- Register every disposable to `context.subscriptions` — never rely on garbage collection.
- Tree providers fire `_onDidChangeTreeData` after any mutation that changes what `getChildren()` would return.
- Long-running command implementations should use `vscode.window.withProgress({ location: Notification })` so users see they're running.
- Webviews are created lazily on first user action, not at activation.
- `activationEvents: []` is correct for view-contributed extensions — VS Code activates us automatically when our view becomes visible.
- Hot reload: `Cmd+R` in the Extension Development Host window after rebuild. F5-based debugging instructions get told off on Mac (lesson 2026-05-15).

## User prompts (D44)

One prompt surface: a **native modal** for every "the tool needs a decision from you" moment.

- **Any confirmation or choice** (confirm a write/import, an ESV apply, a connection removal; pick export depth; acknowledge something critical) → route through `confirm(title, detail, verb)` or `chooseModal(title, detail, ...verbs)` in `src/util/dialogs.ts` (both wrap `showWarningMessage({ modal: true })`). Don't call `showWarningMessage({modal:true})` ad hoc — go through the helper so every confirm looks identical.
- **Non-blocking status** (error / occasional success) → `showErrorMessage` / `showInformationMessage` **without** `modal`.
- **Do NOT use `showQuickPick`** — it's retired (wrong weight for confirms; no documented confirmation pattern). A multi-option pick is a `chooseModal` with one button per option.
- The only prompts that bypass the modal, because a modal physically can't express them: **`withProgress`** (a running progress bar) and **`showInputBox`** (typed free-text, e.g. a secret value).
- A **webview is the app surface, never a confirm dialog** — don't build webview modals; confirmation is always the native modal.
- Irreversible tenant writes (import / ESV apply) get **no "don't ask again"** — per-action friction is intentional (deliberate deviation from the VS Code guideline; see D44).

## PAIC REST patterns

- Construct AM URLs via `getRealmPath()`; script URLs use the short form (`/am/json/<realm>/scripts/...`).
- Always send `Accept-API-Version` per endpoint family:
  - Tree skeleton: `protocol=2.1,resource=1.0`
  - Node payload: `protocol=2.1,resource=1.0` (frodo-style, omitting the `<version>` segment from the URL — verified equivalent to UI's `resource=3.0`)
  - Script: `protocol=2.0,resource=1.0`
- Use service-account JWT-bearer auth only. No cookie auth, no admin-user flow.
- Cookie name (for any diagnostic call that needs the SSO cookie) discovered via `GET /am/json/serverinfo/*` → `cookieName`. Never hardcode `iPlanetDirectoryPro`.
- Pagination: read the `pagedResultsCookie` from each response; if present, send it back as `_pagedResultsCookie` on the next request. Stop when absent.
- **Naming exception for AIC wire-protocol fields.** PAIC's REST API uses leading-underscore field names (`_id`, `_rev`, `_type`, `_queryFilter`, `_pagedResultsCookie`). Our `Raw*` interfaces in `src/paic/mappers.ts` and the URL params in `src/paic/client.ts` mirror these names verbatim so the data layer is a faithful translation. Biome's `useNamingConvention` rule warns on these; the warnings are intentional and accepted. Domain types (`src/domain/types.ts`) use clean camelCase — the mappers translate.

## Commits

- Stage specific files with `git add`, never `-A` — prevents accidentally committing secrets or captured tenant data.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- Append to commit body: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Never commit: `.env` (except `.env.example`), the gitignored `poc/` and `ref/` directories, any captured tenant data (HARs, exports, response JSON).
