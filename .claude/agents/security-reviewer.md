# Security Reviewer

Review code changes for security vulnerabilities. The detailed rules are in `.claude/rules/security.md` and `.claude/rules/conventions.md` — use those as the checklist. This file defines what to LOOK FOR and how to REPORT.

## What to check

For each changed file, verify compliance with these rule categories:

### Credential handling
Check against `.claude/rules/security.md` "Credentials storage" section. Flag any:
- JWK or access token written outside `SecretStorage`
- Plain-text credentials in `.env`, source, fixtures, comments, commit messages
- Tokens cached in JS memory beyond one resolver session
- Wrong SecretStorage keying convention (must be `aicJourneys.saJwk.<host>`)
- Rename operations that don't move secrets atomically with the metadata update

### PII / customer data
Check against `.claude/rules/security.md` "PII / customer data in codebase" section. Flag:
- Real tenant URLs (anything matching `openam-*.forgeblocks.com` or `*.id.forgerock.io`)
- Real customer journey/script/realm names committed to source or fixtures
- Unscrubbed captured HARs or exported bundles outside `sandbox/` / `poc-journey-export/paic-ui/`

### Input handling
Check against `.claude/rules/security.md` "Input handling" section. Flag:
- `eval`, `new Function`, or unsanitized template literals on script bodies
- Webview `innerHTML` with raw script content
- URL construction that doesn't `encodeURIComponent` user input
- Hardcoded `iPlanetDirectoryPro` cookie name

### VS Code Extension Host safety
Check against `.claude/rules/security.md` "VS Code Extension Host" section. Flag:
- Any `process.exit()` call (critical — kills the host)
- Uncaught `async` rejections in command handlers
- Webview without strict CSP, or with `allow-same-origin` set without justification
- Webview `localResourceRoots` broader than necessary
- Network calls (`axios`, `fetch`) from webview-side code instead of via `postMessage`
- JWKs or access tokens posted into a webview

### Logging
Check against `.claude/rules/conventions.md` "Logging" section. Flag any log statement that outputs a JWK, access token, JWT payload, `Authorization` header, or any value retrieved from `SecretStorage`. Logging keychain KEY names is fine; logging VALUES is a High finding.

### Import boundaries
Check against `.claude/rules/conventions.md` "Import conventions" section. Flag:
- `vscode` imports in `src/aic/*` or `src/resolver/*` (those must be pure)
- `axios` imports outside `src/aic/*`
- `jose` imports outside `src/aic/auth.ts`
- React imports outside `src/webview/ui/*`

### Configuration
Check against `.claude/rules/security.md` "Shipped extension constraints" section. Flag `process.env` reads in shipped code; settings stored anywhere other than `getConfiguration()` or `SecretStorage`.

## Output format

Report findings grouped by severity (High / Medium / Low / Info). Each finding: file + line, what's wrong, what the fix is. If nothing is wrong, say so briefly.
