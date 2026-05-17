# Structured Logging Specification

The contract for log output from the PAIC Journeys extension. Pinned here so the design is locked before the M1 logger migration touches existing call sites. Adapted from llm-gateway's [structured-logging-spec.md](../../agentic/llm-gateway/docs/structured-logging-spec.md); divergences are noted inline.

## TL;DR

- **One JSON object per line.** Written via `pino` to two destinations:
  - **File** at `globalStorageUri/logs/paic-journeys.ndjson` — for log shippers (Vector / Filebeat / Promtail / Loki / Datadog).
  - **VS Code Output panel** via a tiny adapter so users still get the friendly in-editor UX.
- **Library: `pino`.** Modern Node default, fast, structured by design. Same as llm-gateway. Locked in via [D9 in design-plan.md](design-plan.md).
- **Universal shape** that every major log system ingests without re-mapping.
- **Migration in M1:** ~10 existing `log.info(...)` call sites in `extension.ts` + `connection-form.ts` convert to typed `log.info({fields}, "msg")` calls. New code in `src/paic/*` and `src/resolver/*` uses the structured shape from day one.
- **Out of scope:** rotation policy beyond size, alerting, log shipping. Those are the user's platform's job (size rotation is done in-process by a small `RotatingFileStream` Writable that composes into `pino.multistream`).

## Goals

1. **Queryable history.** Every event is a JSON object with named fields, so we can answer "did X fail for connection Y?" by filtering, not greping.
2. **Universal format.** Works against Loki today, ELK or Datadog tomorrow, with no app-side change.
3. **Per-operation traceability.** AIC calls log their HTTP status, latency, and `X-ForgeRock-TransactionId`. Resolver walks log journey IDs and cycle hits.
4. **Tier of detail via levels.** Quiet by default (`info`); `paicJourneys.logging.level=debug` for deep dives without reloading.
5. **No new ops surface for the user.** File-on-disk + Output panel. Users who want shipping run their own Vector / Filebeat / etc.

## Non-goals

- HTTP / Slack / email transports — ship via the user's existing tooling, not from the extension.
- OpenTelemetry adoption — overkill for an extension, can be added later if cross-process tracing matters.
- Per-user dashboards — out of scope; user's log platform handles this.
- Network destinations from the extension — see [security.md](../.claude/rules/security.md). All outbound HTTP is to PAIC tenants the user explicitly connected to.

## The log line shape

### Required fields (emitted on every line)

| Field | Type | Source | Example |
|---|---|---|---|
| `time` | string | pino default (`pino.stdTimeFunctions.isoTime`) | `"2026-05-17T15:23:45.123Z"` (ISO 8601 UTC) |
| `level` | string | pino default | `"info"` / `"warn"` / `"error"` / `"debug"` / `"trace"` |
| `msg` | string | passed to logger | `"Test Connection succeeded"` |
| `service` | string | base config | `"paic-journeys"` |
| `version` | string | base config (from `package.json`) | `"0.0.1"` |

### Optional but conventionalized fields

| Field | Type | When | Example |
|---|---|---|---|
| `component` | string | from `log.child({component: "..."})` | `"paic.http"`, `"paic.auth"`, `"resolver.walk"`, `"views.tree"` |
| `event` | string | always when there's a categorical event | `"http.request"`, `"auth.mint"`, `"resolver.cycle"`, `"index.build"` |
| `host` | string | per-connection operations | `"openam-sb3.../"` |
| `realm` | string | per-realm operations | `"alpha"` |
| `journey` | string | per-journey operations | `"kyid_2B1_Login"` |
| `duration_ms` | number | timed operations | `187` |
| `status` | number | HTTP status code | `200` |
| `err` | object | when an Error is involved | `{type, message, stack}` (pino auto-formats) |
| any domain field | any | freely | `script_id`, `node_count`, `dropped_scopes` |

### Example lines

```jsonc
{"time":"2026-05-17T15:23:45.123Z","level":"info","service":"paic-journeys","version":"0.0.1","event":"extension.activated","msg":"Extension activated"}

{"time":"2026-05-17T15:23:50.014Z","level":"debug","service":"paic-journeys","version":"0.0.1","component":"paic.auth","event":"auth.mint","host":"openam-sb3...","msg":"Minted SA bearer token"}

{"time":"2026-05-17T15:23:50.412Z","level":"info","service":"paic-journeys","version":"0.0.1","component":"paic.http","event":"http.request","host":"openam-sb3...","method":"GET","path":"/am/json/realms/root/realms/alpha/realm-config/authentication/authenticationtrees/trees","status":200,"duration_ms":187,"msg":"AIC request handled"}

{"time":"2026-05-17T15:23:51.998Z","level":"error","service":"paic-journeys","version":"0.0.1","component":"paic.http","event":"http.error","host":"openam-sb3...","status":401,"err":{"type":"PaicError","message":"unauthorized","stack":"..."},"msg":"Token rejected — invalidating cache and re-minting"}

{"time":"2026-05-17T15:24:03.241Z","level":"info","service":"paic-journeys","version":"0.0.1","component":"resolver.index","event":"index.build.done","host":"openam-sb3...","realm":"alpha","journey_count":84,"calls":1061,"duration_ms":15130,"msg":"RealmIndex built"}
```

## Field naming conventions

- **`event`**: dotted lowercase, `namespace.action`. Each top-level namespace = a subsystem. Established namespaces:
  - `extension.*` — activation, command registration
  - `connection.*` — add / edit / remove / test
  - `auth.*` — mint / cache / invalidate / scope-fallback
  - `http.*` — request / response / retry / error
  - `resolver.*` — walk / cycle / cache hit-miss
  - `index.*` — build / cancel / progress
  - `tree.*` — expand / collapse / refresh
  - `webview.*` — open / close / postMessage
- **`*_ms`**: durations in milliseconds, always.
- **`*_count`**: integer counts.
- **`status`**: HTTP status code, integer.
- **`err`**: reserved for Error objects; pino auto-serializes `{type, message, stack}`.
- **Don't embed dynamic values in `msg`.** `msg` is human-readable boilerplate; the dynamic part goes in fields.
  - ✅ `log.info({ journey: "Login", node_count: 12 }, "Walked journey")`
  - ❌ `log.info(\`Walked journey Login with 12 nodes\`)`

## Level taxonomy

| Level | When to use |
|---|---|
| `fatal` | Not used (we never crash the Extension Host on purpose; see D10). |
| `error` | An operation failed in a way the user/operator cares about. AIC 5xx, auth invalid, resolver couldn't fetch a referenced script. |
| `warn` | Recoverable abnormal condition. Hit fallback, cache miss with retry, partial result. |
| `info` | Normal operational events. Extension activated, command fired, request handled, resolver started/finished, index built. **Production default.** |
| `debug` | Detailed diagnostic info, only useful when troubleshooting. Request bodies, individual cache hits/misses, intermediate state. Off by default. |
| `trace` | Per-iteration loop internals (walked one node, scanned one journey of N). Lowest level. |

Production: `paicJourneys.logging.level=info`. Troubleshooting: bump to `debug` or `trace` via VS Code setting, no extension reload required if implemented to read on each call.

## Secret redaction

Pino's built-in `redact` paths handle the safety net. The configured paths:

```ts
redact: [
  "saJwk", "*.saJwk",
  "jwk", "*.jwk",
  "bearer", "*.bearer",
  "assertion", "*.assertion",
  "access_token", "*.access_token",
  "*.password", "*.token", "*.secret",
  "authorization", "*.authorization",
]
```

Matching values are replaced with `"[Redacted]"` before serialization. Recursive into nested objects.

**The redaction list is a safety net, not a license.** The rule from [.claude/rules/security.md](../.claude/rules/security.md) still applies: never pass JWKs, tokens, or `SecretStorage` values into logger calls at all.

## Library choice — locked

| | pino | winston | bunyan | custom |
|---|---|---|---|---|
| Speed | ~3× faster | slow | medium | varies |
| Structured by default | ✅ | ⚠️ (configure) | ✅ | depends |
| Active maintenance | ✅ | ✅ | ❌ | n/a |
| Built-in redaction | ✅ (paths) | ⚠️ (plugin) | ❌ | depends |
| Child loggers | ✅ | ✅ | ✅ | depends |
| Used elsewhere in our stack | ✅ (llm-gateway) | ❌ | ❌ | n/a |
| Bundle size | ~15 KB | ~50 KB | ~30 KB | varies |

**Pino.** Same as llm-gateway. Boring correct choice.

## Module layout

```
src/util/logger.ts
  ├── pino instance (top-level, lazy-init on first activate())
  ├── multistream:
  │     - file sink:    rotating NDJSON via in-process RotatingFileStream
  │     - channel sink: tiny Writable adapter → LogOutputChannel
  ├── base fields:  { service: "paic-journeys", version: PKG_VERSION }
  ├── redact paths
  └── export: log, makeLogger(context, fields)
```

`log.child({ component: "paic.http" })` returns a sub-logger that prepends the `component` field. Each subsystem creates its own child and never logs without one (except the top-level `extension.activated` line).

## Migration plan for M1

Existing call sites (10 of them, all in `extension.ts` and `connection-form.ts`):

```ts
// Before
log.info(`addConnection: added "${conn.host}" (saId=${conn.saId})`);

// After
log.info({ event: "connection.add", host: conn.host, sa_id: conn.saId }, "Added connection");
```

```ts
// Before
log.error(`validateConnection: failed host=${data.host} status=${result.status ?? "?"} error=${result.error ?? "?"}`);

// After
log.error({ event: "connection.test.failed", host: data.host, status: result.status, error_code: result.error }, "Test Connection failed");
```

New code in `src/paic/http.ts`, `src/paic/auth.ts`, `src/resolver/*` uses the structured shape from the first line written.

## What changes from current state

| Concern | Before (M0) | After (M1, post-pino) |
|---|---|---|
| Format on disk | `2026-05-17 15:23:45.123 [info] addConnection: added "host"` | NDJSON, fields as above |
| Location | VS Code session log dir (rotates with session) | `globalStorageUri/logs/paic-journeys.ndjson` (rotates at 5 MB × 5) |
| Output panel | Same `LogOutputChannel` | Same — via adapter on pino's second stream |
| `dev-tail.sh` | Tails session log | Tails the NDJSON (path update needed) |
| Secret redaction | None enforced | pino `redact` paths |
| Field shape | Free-text per-message | Structured with `event`, `component`, `host`, etc. |
| Log shipping | Manual session-folder copy | Tail NDJSON with any standard shipper |

`dev-tail.sh` will be updated to default to the NDJSON path and accept `--channel` to fall back to the session log if needed.
