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
