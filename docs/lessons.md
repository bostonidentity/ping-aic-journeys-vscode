# Lessons

Corrections and patterns to avoid repeating. Append entries here whenever a user correction or a failed assumption would otherwise get lost.

## Format

```
## YYYY-MM-DD — Short title
**Context:** what we were doing
**Mistake:** what we assumed or did wrong
**Correction:** what the right thing is
**How to avoid next time:** the rule to apply
```

---

<!-- Entries below, newest first. -->

## 2026-05-18 — AIC platform terminal-node IDs: verify against fixtures, never reconstruct from memory

**Context:** Implementing D28 (synthesize Success/Failure terminals). I wrote the constants by recalling the UUIDs from earlier in the session and reading my own prior code.
**Mistake:** The Failure UUID I committed was `e301438c-0bd0-429c-ab0c-4b8d48aa5b41`. Correct value from frodo-lib captures + real AIC wire payloads is `e301438c-0bd0-429c-ab0c-66126501069a`. Same first segment, fabricated last segment. Also missed that AIC's `staticNodes` has a *third* entry — `startNode` (literal string key) — that AIC's admin UI renders as the visual "Start" pill before the entry node. Both bugs were caught by a real-tenant smoke test on the user's simplest journey (`aaron_test_login` showed no Failure terminal and no Start pill).
**Correction:** The full set of platform-static node IDs is:
- `"startNode"` (literal string) — synthetic start, always implicit before `entryNodeId`
- `"70e691a5-1e33-4ac3-a356-e7b6d60d92e0"` — Success
- `"e301438c-0bd0-429c-ab0c-66126501069a"` — Failure

All three appear under `staticNodes` on the wire. `startNode` is connected to `entryNodeId` implicitly (no edge in `nodes` references it); Success/Failure are targets of edges from real decision/data-store nodes.
**How to avoid next time:** When defining "stable" platform constants (UUIDs, well-known IDs, magic strings), grep them out of captured fixtures or `ref/frodo-lib/` before adding to source. Never type a UUID from memory. A `grep -rn '<first-segment>' ref/frodo-lib/src` takes 2 seconds and would have caught both bugs immediately.

## 2026-05-18 — `/openidm/config/ui/themerealm` uses `realm` (singular), value is the theme array directly

**Context:** Implementing `client.getTheme(realm, themeId)` for the M3 theme leaf + card. Initial code looked under `json.realms[realm].themes` (plural, with `.themes` wrapper).
**Mistake:** Assumed the response wrapper shape. Code silently returned `null` for every theme lookup; ThemeCard showed only the UUID. Surfaced during a smoke-test session against sb3 — user noticed the heading was a UUID and asked "is there a name field?"
**Correction:** The actual wire shape is `{ _id: "ui/themerealm", realm: { <realmName>: RawTheme[] } }` — **singular** `realm`, and the per-realm value is the theme array **directly** (no `.themes` wrapper). Each theme has ~80+ fields including `name`, `isDefault`, `linkedTrees` (journey IDs that link to this theme — free reverse-lookup baked into the response), plus extensive branding/color fields.
**How to avoid next time:** Always probe the actual response shape against a live tenant during initial implementation. A tiny `poc/<resource>-probe.mjs` that dumps `Object.keys` of the first result is cheap insurance. Applies to any AIC resource. The original frodo-lib reference can be wrong / out-of-date for newer endpoints.

## 2026-05-17 — `PreToolUse` Bash hooks fire **before** the shell command runs

**Context:** Built `check-secrets.sh` to scan staged files before `git commit`.
**Mistake:** Used `grep -qE '^git (commit|push)'` and trusted that the hook would see the staging area populated. Tested with `git add danger.txt && git commit -m "..."` — the compound command went through unscathed.
**Correction:** Two distinct bugs:
1. `^git (commit|push)` only matches when the command *starts* with `git commit`/`git push`. Compound commands beginning with `git add` (or anything else) fail the regex.
2. Even with the anchor removed, the hook fires *before* the Bash command runs. When staging happens inside the same chain (`git add X && git commit`), the staging area is empty at scan time — secrets sneak through.
**Fix shipped:** Hook now refuses any single Bash invocation containing **both** `git add` and `git commit`/`git push`, forcing them into separate calls so the second one sees a populated staging area.
**How to avoid next time:** When designing a `PreToolUse:Bash` security gate, ask: *if the user does X and Y in one compound command, will the gate's view of the system reflect post-X state or pre-X state?* It's pre-X. Either refuse compound commands or reason about post-X state explicitly.

## 2026-05-15 — `F5` is not a usable dev shortcut on Mac

**Context:** Initial dev-loop instructions told the user to press F5 to launch the Extension Development Host.
**Mistake:** Assumed F5 was free. On Mac it's commonly captured by Dictation or the function-key overlay.
**Correction:** Use `Cmd+Shift+P` → "Debug: Start Debugging" instead. Fn+F5 also works.
**How to avoid next time:** When recommending VS Code shortcuts, prefer Command Palette names over keybindings; users' chord configs and OS-level shortcuts vary.

## 2026-05-15 — `LogOutputChannel` log file path is not where the docs imply

**Context:** Wrote a `dev-tail.sh` helper to follow the extension's log file from a terminal.
**Mistake:** Assumed the file lived under `output_logging_<ts>/<n>-PAIC Journeys.log`. That's where some Output channels go.
**Correction:** `LogOutputChannel`s created with `{ log: true }` write to `<session>/window<N>/exthost/<publisher>.<extension>/<channel-name>.log` — a per-extension directory, not the shared `output_logging_*` folder.
**How to avoid next time:** The disk path differs between `OutputChannel` and `LogOutputChannel`. Always verify the actual file location with `find` after triggering at least one log line; don't infer it from docs.

## 2026-05-15 — Cookie name on PAIC tenants is per-tenant random, not `iPlanetDirectoryPro`

**Context:** Attempted to replay HAR-captured calls using a copied session cookie.
**Mistake:** Used `iPlanetDirectoryPro` as the cookie header name. Got 401.
**Correction:** Each PAIC tenant has a random cookie name visible at `GET /am/json/serverinfo/*` → `cookieName` field. On the captured tenant it was `9ed2dc164aff213`.
**How to avoid next time:** Never hardcode AM session cookie names. Discover them at runtime — and for any scripted client, prefer service-account JWT-bearer over cookie replay anyway.

## 2026-05-15 — The `id_token` in a HAR's oauth2/authorize redirect is NOT usable for AM REST

**Context:** Tried to use the `id_token` captured from a `/am/oauth2/authorize?prompt=none&client_id=idmAdminClient&response_type=id_token` redirect to replay AM REST calls.
**Mistake:** Assumed any bearer token from the admin UI's auth flow would work on AM endpoints.
**Correction:** That token is scoped `fr:idm:*` and audience `idmAdminClient` — it's for IDM-side calls only. AM REST endpoints under `/am/json/.../realm-config/...` rejected it with 401. The UI's actual AM auth is the per-tenant session cookie, not this token.
**How to avoid next time:** Decode any token (`jwt.io`-style) and check `scope` + `aud` before assuming it works against a given endpoint. Auth flows for AM and IDM in PAIC are not the same.
