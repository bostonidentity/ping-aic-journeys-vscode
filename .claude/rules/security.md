# Security Rules

## Credentials storage

- Service-account JWKs live in **VS Code SecretStorage** (`context.secrets`), keyed by `aicJourneys.saJwk.<host>`. OS keychain on Mac/Linux/Windows. Never on disk in plaintext.
- Plaintext fields (`host`, `saId`, optional `name`) live in `aicJourneys.connections` (a normal VS Code setting in `settings.json`). These are NOT secrets.
- Access tokens minted from JWKs live **in memory only** for the lifetime of one resolver session. Never persisted, never logged.
- Credentials NEVER in `.env` / env files, source files, fixtures, comments, commit messages, logs, or webview-side JS memory.
- On a host rename (Edit command), move the secret to the new key and delete the old key in the same operation.

## PII / customer data in codebase

- Never put real credentials, real tenant URLs, real customer journey/script/realm names, or any real PII in source, tests, fixtures, config, comments, commit messages, or docs.
- Dummy values for all non-sandbox code:
  - host: `openam-tenant.example.forgeblocks.com`
  - saId: `00000000-0000-0000-0000-000000000000`
  - realm: `alpha` / `beta` (these are AIC's stock names; safe)
  - journey: `Login` / `Registration` (generic) or `webauth_login_example`
  - script: `example-script` / `helpers`
- Captured HARs, exported journey bundles, and real tenant data live ONLY in `sandbox/` or `poc-journey-export/paic-ui/` (gitignored). Never committed, never uploaded, never in a PR.
- `.env` files never committed. Only `.env.example` (if any) at repo root with dummy values.

## Shipped extension constraints

- The shipped extension reads NO `process.env` for runtime configuration. All runtime config flows through VS Code's `getConfiguration()` and `SecretStorage`.
- Configuration splits into three categories:
  - Plaintext per-connection metadata → `aicJourneys.*` settings (`settings.json`)
  - Per-connection secrets → `SecretStorage`
  - User preferences (log level, default realm, etc.) → `aicJourneys.*` settings
- No telemetry. No remote sync of anything beyond what VS Code Settings Sync moves automatically (which is only the plaintext settings).

## Logging

- Never log JWKs, access tokens, JWT payloads, or any value retrieved from `SecretStorage`.
- Logging the keychain KEY name (`aicJourneys.saJwk.openam-...`) is fine. Logging the VALUE is a finding.
- Tenant hosts in logs are OK (they're not secret). Service-account IDs are OK (they're not secret on their own).
- Use `log.debug` for verbose dev-only output (request bodies, response bodies). Ship at `INFO` by default.
- Redact: the logger should automatically scrub keys matching `/saJwk|password|token|secret/i` from any object passed to it.

## Input handling

- Never `eval` or `new Function` on script bodies fetched from AIC.
- Never render raw script bodies via webview `innerHTML`. Pass them as text content or feed them to a syntax highlighter that escapes its input.
- All AIC REST URLs constructed via the `getRealmPath()` helper and `encodeURIComponent` for any user-provided segment.
- Cookie name discovery (`GET /am/json/serverinfo/*`) is for read-only diagnostic use; we don't use cookies for auth.

## VS Code Extension Host

- **Never call `process.exit()`.** It kills the Extension Host and takes down every extension in the session.
- All async errors must be caught at command-handler boundaries. An uncaught rejection in a registered command can leave VS Code's UI in a bad state.
- Webviews must declare a strict CSP. Never set `allow-same-origin` unless you have a specific, audited reason.
- `localResourceRoots` on a webview must be the narrowest possible — typically just `media/` and the bundled webview output.
- Network requests (`axios.get`, etc.) happen in extension code ONLY. Webviews send messages to the extension; the extension makes the call.
- Service-account creds are passed to webviews ONLY as opaque session IDs the extension can later look up. Never the JWK, never the access token.
