# Finding 04 — Subsystems worth borrowing from frodo-lib and fr-config-manager

**Date:** 2026-05-15
**Decision context:** We're building the journey-dependency analyzer with **raw axios + our own JWT-bearer auth** (see "foundation choice" in conversation), NOT depending on frodo-lib or fr-config-manager. But these projects have years of accumulated wisdom in their lower layers. This doc audits each subsystem and records what to borrow as **ideas** (not code-copy) into our extension.

**Constraints the borrow decisions respect:**
- VS Code extension runtime → `process.exit()` is forbidden.
- Minimal dependencies → every transitive matters for VSIX size + activation time.
- No global singleton state → tenant + creds passed explicitly.
- TypeScript-first.

---

## Audit table

| # | Subsystem | Borrow? | Effort | One-line answer |
|---|---|---|---|---|
| 1 | Service-account JWT-bearer auth | **Idea + flow** | ~2h | Take the JWT-bearer exchange flow + scope fallback; skip the global `State`. |
| 2 | HTTP layer / axios wrapper | **Header pattern** | ~1h | Take the header-injection pattern + 30s timeout default; skip `axios-retry`. |
| 3 | Error wrapping | **Idea** | ~30m | Make our own `AicError` that extracts axios response status/body/error code. |
| 4 | Realm-path computation | **Copy verbatim** | 10m | One function, canonical, ten lines, copy as-is. |
| 5 | Pagination on `_queryFilter=true` | **Loop pattern** | ~1h | Plain while-loop reading `_pagedResultsCookie`. |
| 6 | Config / cred carrier | **Idea, NOT shape** | ~30m | One plain object passed in. Don't mirror frodo's 150-method class. |
| 7 | Logging / debug | **Handler pattern** | ~30m | Inject a logger callback; default to VS Code OutputChannel. |
| 8 | Misc helpers (base64, JSON canonicalize, name-safe) | **Selective** | ~30m | Take base64 + canonical-JSON; reroll filename safing inline. |

Total realistic budget for the entire foundation layer: **~6 engineering hours**.

---

## 1. Service-account JWT-bearer authentication

**Where to read:**
- frodo-lib: `src/ops/AuthenticateOps.ts` lines ~940-1029 (`createPayload`, `getAccessTokenForServiceAccount`)
- frodo-lib: `src/api/AccessTokenApi.ts` (token endpoint POST)
- fr-config-manager: `packages/fr-config-common/src/authenticate.js` lines ~94-148
- aic-pipeline: `aic-pipeline/src/lib/iga-api.ts` lines 84-140 (already a port we can lift from)

**What the flow looks like (canonical):**

```
1. Sign a short-lived JWT (180s) with the SA's private key:
   header  = { alg: "RS256", typ: "JWT", kid?: "<jwk.kid>" }
   payload = {
     iss: serviceAccountId,
     sub: serviceAccountId,
     aud: `${tenantOrigin}/am/oauth2/access_token`,
     exp: now + 180,
     jti: randomUuid()
   }

2. POST /am/oauth2/access_token  (application/x-www-form-urlencoded)
     grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
     assertion=<signed JWT>
     scope=fr:am:* fr:idm:* fr:idc:esv:*    (space-separated)
     client_id=service-account              (sometimes required, sometimes not)

3. Response → { access_token, expires_in, scope }
   Cache token in-memory with expiresAt = now + expires_in - 25s buffer.

4. Use it: every request sets
     Authorization: Bearer <token>
```

**Worth borrowing — IDEAS:**

- **Scope fallback.** frodo-lib (`AuthenticateOps.ts:995-1015`) does a *graceful degrade* when the tenant rejects requested scopes: parses the `invalid_scope` error_description, drops the rejected scopes, retries. Tenants vary in which scopes they grant; this avoids a brittle hardcoded list.
- **Key-format flexibility.** fr-config-manager (`authenticate.js:13-17`) accepts either PEM or JWK by checking for the `-----BEGIN` marker. Useful — aic-pipeline only takes JWK; some users have PEM files from `openssl`.
- **Expiry buffer.** Both projects subtract a small buffer (frodo: 25s, aic-pipeline: 30s) from the reported `expires_in`. Without this, a token that expires "in flight" produces a confusing 401 instead of clean refresh.
- **Separate read / check / write** for the cache so the same code path works for "do I have a token?" and "give me a token (mint if needed)".

**What to skip:**
- frodo-lib's global `state.getServiceAccountId()` / `state.getServiceAccountJwk()` pattern. Pass creds explicitly.
- `2FA callbackHandler` param (`AuthenticateOps.ts:69-70`). It's for interactive admin-user logins — we only support service-account.
- The auto-refresh timer (`AuthenticateOps.ts:1306-1358`) that runs in the background. In an extension, refresh on-demand right before a call; no setTimeout in the host.
- winston/tinyrainbow logging entanglement. Use the logger pattern from §7.

**Recommended structure:**

```typescript
// src/aic/auth.ts
export interface SaCredentials {
  tenantUrl: string;
  saId: string;
  saKey: JWK | string;        // JWK object or PEM string
  scope?: string;             // optional override; default to known good set
}

export interface CachedToken {
  accessToken: string;
  expiresAt: number;          // epoch ms
  scope: string;
  fromCache: boolean;
}

export class TokenSource {
  constructor(private creds: SaCredentials) {}
  async get(): Promise<CachedToken> { /* mint or cache */ }
  invalidate(): void { /* on 401 */ }
}
```

One `TokenSource` per tenant. Lives for the lifetime of the connection, gets re-minted lazily.

---

## 2. HTTP layer / axios wrapper

**Where to read:**
- frodo-lib: `src/api/BaseApi.ts` lines 45-248
- fr-config-manager: `packages/fr-config-common/src/restClient.js` lines 110-291

**What to borrow:**

- **Header injection pattern.** frodo-lib's `BaseApi.ts:202-228` uses spread for conditional headers:
  ```ts
  const headers = {
    "Accept-API-Version": apiVersion,
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    ...(authHeader && { Authorization: authHeader }),
    ...(transactionId && { "X-ForgeRock-TransactionId": transactionId }),
  };
  ```
  Clean, composable, no `if` blocks.
- **Transaction IDs.** frodo-lib stamps every request with `X-ForgeRock-TransactionId: frodo-<uuid>`. Massively helpful when you correlate with PAIC's audit logs. We should do `aic-journeys-<uuid>` or similar.
- **30s timeout default** with per-call override.
- **`validateStatus: s => s < 400`** — keep 3xx as success (useful for redirects on auth endpoints).
- **One axios instance per tenant** with the base URL + default headers baked in. Per-call only sets path + apiVersion + body.

**What to skip:**
- `axios-retry`. ~500 KB transitive cost. Hand-roll 15 lines of exponential backoff:
  ```ts
  async function withRetry<T>(fn: () => Promise<T>, opts = { tries: 3, baseMs: 200 }): Promise<T> {
    let last: unknown;
    for (let i = 0; i < opts.tries; i++) {
      try { return await fn(); }
      catch (e) { last = e; if (!isRetryable(e)) throw e; await sleep(opts.baseMs * 2 ** i); }
    }
    throw last;
  }
  ```
  Retry on network errors, 502/503/504, and `ECONNRESET`. Don't retry on 4xx (it's our bug, not theirs).
- `agentkeepalive` tuning. axios defaults are fine for a single-user tool.
- frodo's "curlirize" debug rendering — clever, but the `curl -v` form has stale dependency overhead. If we want to print a request, we can do it directly with 5 lines.
- fr-config-manager's `process.exit(1)` on every error. Throw instead.

**Recommended structure:**

```typescript
// src/aic/http.ts
export function makeClient(opts: {
  tenantUrl: string;
  tokenSource: TokenSource;
  logger?: Logger;
}): AxiosInstance {
  const instance = axios.create({
    baseURL: opts.tenantUrl,
    timeout: 30_000,
    validateStatus: s => s < 400,
  });
  instance.interceptors.request.use(async (config) => {
    const t = await opts.tokenSource.get();
    config.headers.set("Authorization", `Bearer ${t.accessToken}`);
    config.headers.set("X-ForgeRock-TransactionId", `aic-journeys-${randomUUID()}`);
    return config;
  });
  instance.interceptors.response.use(undefined, async (error) => {
    if (error.response?.status === 401) {
      opts.tokenSource.invalidate();   // one retry with fresh token
    }
    throw new AicError(error);
  });
  return instance;
}
```

---

## 3. Error wrapping

**Where to read:**
- frodo-lib: `src/ops/FrodoError.ts` (full file, ~138 lines)

**What to borrow — the IDEA:**

`AxiosError`s are *terrible* to read at a stack-trace site: nested objects, no clear "what was the status," `error_description` buried somewhere. frodo-lib's `FrodoError` extracts the useful fields into top-level properties at construction time, and provides `getCombinedMessage()` that renders nicely.

For us, this means: **every error that crosses our API boundary becomes an `AicError`** with at least:
- `message` — human readable
- `status` — HTTP status if any
- `code` — AIC's `error` field if present (e.g. `invalid_scope`)
- `description` — AIC's `error_description` if present
- `body` — full response body for debugging
- `cause` — original error preserved

This is ~50 lines, no dependencies. Skip the recursive nested-error rendering — we don't need CLI-style indented output; we need to surface the message to a VS Code notification.

---

## 4. Realm-path computation — COPY VERBATIM

**Where:** frodo-lib `src/utils/ForgeRockUtils.ts:174-184`

```typescript
export function getRealmPath(realm: string): string {
  if (!realm) realm = '/';
  if (realm.startsWith('/')) realm = realm.substring(1);
  const elements = ['root'].concat(realm.split('/').filter(el => el !== ''));
  return `/realms/${elements.join('/realms/')}`;
}
```

Why ten lines deserve their own bullet:
- Handles `"alpha"` → `/realms/root/realms/alpha`
- Handles `"/alpha"` → same (leading slash tolerated)
- Handles `"alpha/beta"` (sub-realm) → `/realms/root/realms/alpha/realms/beta`
- Handles empty → `/realms/root`

Every AM endpoint URL we build uses this. Bug-free, drop in, done.

**Note:** the AM script endpoint uses a *different* form (`/am/json/<realm>/scripts/<uuid>`, no `realms/root/realms/` wrapping). Don't apply `getRealmPath` to script URLs. Keep two helpers:

```typescript
const amEndpoint   = (realm, path) => `/am/json${getRealmPath(realm)}${path}`;
const amScriptPath = (realm, id)   => `/am/json/${realm}/scripts/${id}`;
```

---

## 5. Pagination

**Where to read:**
- frodo-lib uses both offset (`_pagedResultsOffset`) and cookie (`_pagedResultsCookie`) styles. AM modern endpoints prefer cookie-based.

**What to borrow — the pattern:**

```typescript
async function* paginated<T>(client, path, params, pageSize = 100): AsyncIterable<T> {
  let cookie: string | undefined;
  do {
    const res = await client.get(path, {
      params: { ...params, _pageSize: pageSize, _pagedResultsCookie: cookie }
    });
    for (const item of res.data.result) yield item as T;
    cookie = res.data.pagedResultsCookie;   // undefined when last page
  } while (cookie);
}
```

Async iterator means callers can `for await (const j of paginated(client, "..."))` and stream. No accumulation in memory if we don't need it.

**What to skip:**
- frodo-lib's `postApiSearchAll` wrapper. Adds state-bound handlers; not worth it.

---

## 6. Config / credentials carrier

**Where to read:**
- frodo-lib: `src/shared/State.ts` (don't copy — it has ~150 getters/setters)
- fr-config-manager: `packages/fr-config-common/src/getConfig.js` (reads env vars)
- aic-pipeline: `aic-pipeline/src/lib/env-parser.ts` (also env-driven)

**What to borrow — the IDEA:**

One plain object carrying everything needed for one tenant connection. Pass it down. No singletons.

```typescript
// src/aic/types.ts
export interface TenantConnection {
  label: string;             // user-facing name
  tenantUrl: string;
  realm: string;
  credentials: SaCredentials;
  customHeaders?: Record<string, string>;  // for proxies that require them
}
```

VS Code stores the `TenantConnection` minus credentials in `workspace.getConfiguration()`. Credentials go in `SecretStorage`. At resolve time, we combine them into a complete `TenantConnection` and hand it to the client factory.

**What to skip:**
- frodo-lib's monolithic class. Hard to test, hard to compose, hard to support multi-tenant in an extension that may show several tenants in the tree at once.
- Persistent on-disk token caches. Tokens live for an hour; just hold them in memory per `TokenSource`.

---

## 7. Logging / debug

**Where to read:**
- frodo-lib: `src/utils/Console.ts:1-72` (the handler-injection pattern)

**What to borrow — the pattern:**

Don't `console.log` from library code. Take a logger as a dependency:

```typescript
// src/util/logger.ts
export interface Logger {
  info(msg: string, ctx?: object): void;
  verbose(msg: string, ctx?: object): void;
  debug(msg: string, ctx?: object): void;
  error(msg: string, ctx?: object): void;
}

// extension wires this to a vscode.OutputChannel:
export function makeVscodeLogger(channel: vscode.OutputChannel): Logger { ... }

// tests wire it to a buffer:
export function makeBufferLogger(): Logger & { lines: string[] } { ... }
```

Tests get silent execution. Users get a "AIC Journeys" output channel. Same code paths.

**What to skip:**
- winston (too big, async, opinions about transports we don't need).
- tinyrainbow / chalk (no ANSI in VS Code output channels).
- frodo-lib's `printError` that also calls `process.exit` in some CLI wrappers — we throw instead.

---

## 8. Misc helpers

| Helper | Source | Take? |
|---|---|---|
| `isBase64Encoded(s)` regex | frodo-lib `Base64Utils.ts:44` | Copy. Used to decide whether a script body returned by AIC is wrapped. |
| `decodeBase64Url(s)` | frodo-lib `Base64Utils.ts` | Copy. JWT inspection if we ever debug an auth issue. |
| Canonical JSON stringify (sorted keys) | frodo-lib `JsonUtils.ts` | Copy. Useful for diff/cache-key. |
| `cloneDeep` / `mergeDeep` | frodo-lib `JsonUtils.ts` | Skip — use `structuredClone` (Node 17+, in our VS Code engine target). |
| `journeyNodeNeedsScript()` | fr-config-common `utils.js:98-102` | Tiny but useful — formal definition is `node.useScript !== false && !!node.script`. Copy. |
| Filename safing (`slugify` dep) | frodo-lib & fr-config-manager | Skip the library. Inline `s.replace(/[^\w.-]+/g, "_")` if needed. Probably not needed at all — we're not writing files. |
| `getLibraryScriptNames(script)` | frodo-lib `ScriptOps.ts` | Borrow the regex/AST for finding `require()` calls inside a script body. We need this for library-script recursion. |
| `getTreeDescendents()` walker shape | frodo-lib `JourneyOps.ts:2768` | Borrow the *shape* (BFS, cycle guard via visited-set). Re-implement against our `AicClient`, returning a graph instead of a TreeDependencyMap. |

---

## What the foundation layer ends up looking like

After borrowing the above and writing the resolver on top:

```
src/aic/
  types.ts               # TenantConnection, Tree, Node, Script, etc.
  auth.ts                # TokenSource (JWT-bearer mint + cache + invalidate)
                         #   borrows: SA-JWT flow, scope fallback, expiry buffer
  http.ts                # makeClient() — axios instance per tenant
                         #   borrows: header-injection pattern, transaction id, 30s timeout
  realm-path.ts          # getRealmPath() — copied verbatim from frodo
  pagination.ts          # async iterable for _queryFilter=true endpoints
  errors.ts              # AicError class — borrows the FrodoError idea, slimmer
  client.ts              # AicClient — listJourneys, getTree, getNode, getScript
src/util/
  logger.ts              # Logger interface + VS Code OutputChannel impl
  base64.ts              # isBase64Encoded, decode
  json-canon.ts          # canonical stringify
src/resolver/
  graph.ts               # DependencyGraph type
  walk.ts                # walkJourney(client, journeyId) → DependencyGraph
                         #   borrows: getTreeDescendents recursion + cycle-guard shape
                         #   borrows: getLibraryScriptsRecurse shape
                         #   adds: themes, ESVs, email templates as nodes
  cache.ts               # per-session memo (script-by-uuid, tree-by-id)
```

Total expected size: **~1500 LOC** including types. Zero runtime dependencies beyond `axios`, `jose` (for JWT signing), and whatever ReactFlow needs in the webview.

---

## Things we are explicitly NOT taking

These come up a lot when reading frodo-lib and they LOOK tempting but don't fit our shape:

1. **The global `State` singleton.** Multi-tenant extension; needs per-connection state.
2. **`axios-retry` and `agentkeepalive`.** Dependency tax > benefit at our scale.
3. **`process.exit(1)` on error** (fr-config-manager's habit). Forbidden in Extension Host.
4. **CLI-style colored output / progress bars.** VS Code output channels don't render ANSI; use `withProgress` for progress UI.
5. **Connection-profile persistence on disk** (frodo's `.frodorc`). VS Code's `SecretStorage` is the right home.
6. **The token auto-refresh background timer.** Re-mint on demand instead.
7. **Auto-detection of node types via `getAllTypes` action.** We have hardcoded knowledge of the dozen node types we care about; no need to enumerate.
8. **Curlirize / debug request rendering as `curl` lines.** Useful in CLI; in extension we have `webview-side network panel` or just `logger.debug({req, res})`.

---

## Action items in order

1. Port `iga-api.ts` (aic-pipeline) → `src/aic/auth.ts`. It's already 90% what we want; add the scope-fallback idea from frodo.
2. Write `src/aic/http.ts` (~80 lines).
3. Copy `getRealmPath` into `src/aic/realm-path.ts`.
4. Write `src/aic/errors.ts` — `AicError` class (~50 lines).
5. Write `src/aic/client.ts` with five methods (`listJourneys`, `getTree`, `getNode`, `getScript`, `getScriptByName`).
6. Write `src/aic/pagination.ts` (~20 lines, async iterable).
7. Write `src/util/logger.ts` (~30 lines, interface + impl).
8. Build the resolver on top.

Foundation should be done in a couple of focused sessions. Then we're in resolver-land.
