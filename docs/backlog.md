# Backlog

Findings discovered via the walkthrough skill. One row per finding, grouped by type (`B-NN` bugs · `D-NN` design changes). Status cycles: `open` → `in-progress` → `done` (or `rejected` / `deferred`). Phase-sized work doesn't live here — it gets promoted to `docs/progress.md` instead.

## B-01 — Opening an on-prem root-realm script throws "Malformed script URI"
**Where:** `src/providers/script-fs-provider.ts` (`parseScriptUri` / `makeScriptUri`)
**Observed:** With an on-prem connection, clicking a script under "Top Level Realm" errors instead of opening the body. On-prem root journeys/scripts use `realm=""` (D41 Slice 3); `makeScriptUri(host, "", id)` yields `paic-script://host//id.js`, and `parseScriptUri` does `uri.path.split("/").filter(Boolean)` — the empty realm segment collapses to a single segment, tripping the `parts.length < 2` "Malformed" guard.
**Proposed:** Treat a single path segment as the root realm (`realm=""`) instead of malformed — require only the filename. Truly-empty paths stay malformed. Add root-realm round-trip + provider tests.
**Status:** done — necessary companion to B-02; confirmed in the EDH. Misdiagnosis note: the live error was "Connection not found: http:", not "Malformed".

## B-02 — On-prem script open fails: full-URL host can't live in the `paic-script://` authority
**Where:** `src/providers/script-fs-provider.ts` (`makeScriptUri` / `parseScriptUri`)
**Observed:** Opening an on-prem script (e.g. `alpha-demo-decision`) → "The editor could not be opened due to an unexpected error." Log: `scriptFs.clientUnavailable host=http: message=Connection not found: http:`. The on-prem `host` is a base URL (`http://openam.bipoc.net:8080/am`); `makeScriptUri` puts it in the URI authority (`paic-script://<host>/…`), which can't hold `://` — the parser reads the authority as just `http:`, so `ClientCache.get("http:")` fails. PAIC hosts are bare hostnames so this never surfaced.
**Proposed:** `encodeURIComponent(host)` when building the URI authority and `decodeURIComponent(uri.authority)` when parsing, so a full-URL host round-trips. PAIC (plain hostname) is unchanged. Add on-prem-host round-trip tests.
**Status:** done — confirmed in the EDH

## B-03 — Same host-in-authority bug in the email-template FS provider
**Where:** `src/providers/email-template-fs-provider.ts` (`makeEmailTemplateUri` / `parseEmailTemplateUri`)
**Observed:** Audit (user asked to check for the same PAIC-vs-on-prem host difference) found the identical flaw as B-02: host raw in the `paic-email-template://<host>/…` authority. Latent on-prem — email templates are Tier-B (no IDM), so `getEmailTemplate` short-circuits to null and no email-template node/URI is ever built on-prem — but the same incorrect pattern. Everything else (uids, resolver keys, URL-building) is opaque or already scheme-guarded — no other instances.
**Proposed:** Mirror B-02 — `encodeURIComponent`/`decodeURIComponent` the host in the authority. Add a URL-host round-trip test.
**Status:** done — confirmed in the EDH

## B-04 — Journeys show "Disabled" on AM versions that omit the `enabled` field
**Where:** `src/paic/mappers.ts` (`mapJourney`)
**Observed:** Against a real prod on-prem AM (older version), the sidebar showed EVERY journey as `(disabled)`. Confirmed from the raw `trees?_queryFilter=true` response: tree objects there are `{_id, _rev, identityResource, nodes, uiConfig, staticNodes, entryNodeId, description}` — **no `enabled` field**. `mapJourney` did `enabled: raw.enabled ?? false`, so an absent field defaulted to `false`. Our AM 7.5.2 bed returns `enabled: true` explicitly, which is why it looked fine in dev.
**Proposed:** `enabled: raw.enabled ?? true` — AM treats a tree as enabled unless explicitly `enabled: false`. Only an explicit `false` shows Disabled; `true` or absent shows Enabled. Add a mapper regression test.
**Status:** done — confirmed from the prod trees response (no `enabled` field); shipped in 0.1.1.

## D-01 — Label the on-prem root realm "root" (not "Top Level Realm")
**Where:** `src/views/nodes/realm.ts` (`RealmNode` label)
**Observed:** On-prem connections show the platform root realm as "Top Level Realm". User prefers it shown as "root". (PAIC still hides root; on-prem still shows it — division unchanged.)
**Proposed:** Change the `isRoot` tree label from "Top Level Realm" → "root".
**Status:** done — confirmed in the EDH
