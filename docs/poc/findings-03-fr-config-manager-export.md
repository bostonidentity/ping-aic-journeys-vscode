# Finding 03 — How fr-config-manager exports (pulls) journeys

**Date:** 2026-05-15
**Source:** `poc-journey-export/fr-config-manager/` (ForgeRock-maintained, MIT)
**Reference command:** `fr-config-pull journeys [-n <name>] [-r <realm>] [-d|--pull-dependencies] [-c|--clean]`

---

## TL;DR — three big differences vs UI and frodo

1. **It uses `_queryFilter=true` to fetch every node of a type at once**, not one GET per UUID. For a tree with ten nodes spread over three types, it issues ~3 node calls, not 10.
2. **It sends NO `Accept-API-Version` header.** It relies on AM's defaults.
3. **On disk it produces a directory tree, not a bundle** — one JSON per node, PageNodes become subdirectories, scripts are decoded to real `.js` files in a separate `scripts/` tree with a JSON manifest pointing to the file.

It's also **fully sequential** — no parallelism anywhere — and **narrower in dependency scope** than frodo. Only scripts and (optionally) inner trees are followed inline from journeys.

---

## Entry point + scope name

CLI scope keyword: **`journeys`** (defined `packages/fr-config-common/src/constants.js:36` as `COMMAND.AUTH_TREE = "journeys"`).

Top-level dispatch: `packages/fr-config-pull/src/index.js:220-240` calls `journeys.exportJourneys(exportDir, tenantUrl, realms, name, pullDependencies, clean, token)`.

Flags:

| Flag | Effect |
|---|---|
| `-n, --name <id>` | Limit to a single journey |
| `-r, --realm <realm>` | Limit to a single realm (else all in `REALMS` env) |
| `-d, --pull-dependencies` | Also pull scripts and (when `-n` is also set) recurse into `InnerTreeEvaluatorNode` targets |
| `-c, --clean` | `rm -rf` the per-journey `nodes/` directory before re-pulling |

The single CLI surface is fixed-shape: there's no `--use-string-arrays`, no `--no-coords`, no bundle-output option.

---

## The algorithm

`packages/fr-config-pull/src/scripts/journeys.js`

```
For each realm in REALMS:
  L170: GET .../authenticationtrees/trees?_queryFilter=true
        → returns ALL trees in the realm (their skeletons), in one call.
  processJourneys(...)
    For each tree in the response (or just the matching one if -n):
      L71-79: mkdir <CONFIG_DIR>/<realm>/journeys/<safe(treeId)>/nodes/
              (if --clean, rm -rf the nodes dir first)
      For each (nodeId, nodeInfo) in tree.nodes:
        L84-90: cacheNodesByType(nodeType) — see below; first time per type
                hits AM, subsequent lookups hit the in-memory cache
        L91:    pick the matching node out of the cached array
        If node._type._id === "PageNode":
          L98-100: mkdir <nodeDir>/<safe(displayName-nodeId)>/
          For each child in node.nodes:
            L104-110: cacheNodesByType for child's type
            L111-113: lookup child in cache
            L118: write child JSON to <pageNodeDir>/<safe(child name)>.json
            L119-127: if --pull-deps AND child needs script, fetch script
        Else if --pull-deps AND node needs script:
          L129-130: fetch script via exportScriptById
        Else if name set AND --pull-deps AND node is InnerTreeEvaluatorNode:
          L136-145: recurse processJourneys() with node.tree
        L148: write node JSON to <nodeDir>/<safe(displayName-nodeId)>.json
      L151-152: write tree JSON to <journeyDir>/<treeId>.json
```

`cacheNodesByType` (`journeys.js:15-33`):

```js
const amEndpoint = `${tenantUrl}/am/json/realms/root/realms/${realm}/realm-config/authentication/authenticationtrees/nodes/${nodeType}`;
const response = await restGet(amEndpoint, { _queryFilter: "true" }, token);
nodeCache[nodeType] = response.data.result;
```

**Per nodeType, ONE GET that returns ALL nodes of that type in the realm.** Subsequent nodes of the same type are picked out of the in-memory cache. This is the most striking REST-shape difference.

`exportScriptById` (`scripts.js:87-97`):

```js
const amEndpoint = `${tenantUrl}/am/json/${realm}/scripts/${id}`;
const response = await restGet(amEndpoint, null, token);
saveScriptToFile(response.data, fileDir);
```

---

## REST endpoints actually used

Realm path is `realms/root/realms/<realm>` for tree/node endpoints (same as UI). Script endpoint uses the shorter `/am/json/<realm>/scripts/...` form (same as UI and frodo).

| Resource | Method | URL | Accept-API-Version |
|---|---|---|---|
| List trees | GET | `.../authenticationtrees/trees?_queryFilter=true` | **none** |
| List all nodes of a type | GET | `.../authenticationtrees/nodes/{NodeType}?_queryFilter=true` | **none** |
| Get one script | GET | `/am/json/{realm}/scripts/{uuid}` | **none** |

About the missing `Accept-API-Version`: `packages/fr-config-common/src/restClient.js:293-309` defines `restGet(url, params, token, apiVersion, ignoreNotFound)`. The journeys/scripts callsites pass only the first three arguments (`restGet(amEndpoint, null, token)` at `journeys.js:172` and `scripts.js:90`), so `apiVersion` is `undefined` and the header is omitted (`restClient.js:210-211`: `if (apiVersion) request.headers["Accept-API-Version"] = apiVersion`). AM defaults are good enough for these endpoints today, but this is brittle if AM bumps a default-protocol version.

---

## Comparison of REST shape across the three tools

| Concern | PAIC UI | frodo | fr-config-manager |
|---|---|---|---|
| List trees | n/a (UI exports specific selections) | n/a (`-a` walks them too) | `GET trees?_queryFilter=true` |
| Get one tree | `GET trees/<id>` | `GET trees/<id>` | not used — tree skeleton comes from the list call above |
| Get one node | `GET nodes/<Type>/<ver>/<uuid>` `resource=3.0` | `GET nodes/<Type>/<uuid>` `resource=1.0` | `GET nodes/<Type>?_queryFilter=true` → pick by uuid in-memory `(no apiVersion)` |
| Calls per N nodes spread over T types | N | N | T |
| Script body | `GET scripts/<uuid>` `2.0,1.0` | `GET scripts/<uuid>` `2.0,1.0` | `GET scripts/<uuid>` `(no apiVersion)` |
| Parallelism | high (Promise.all fan-out, ~140 ms total) | high (Promise.all per wave) | **none** — fully sequential await chain |

The fr-config-manager approach uses **fewer calls per tree** but **more bytes per call** (you get the whole type-list, not just one node). For tenants with many nodes per type, this could actually pull more data than the UI's per-node approach — but it's the same trade-off `_queryFilter` always implies.

---

## Dependency scope

When `--pull-dependencies` is on, only these follow-on calls fire from inside the journey pull:

| Follow-on | Behaviour |
|---|---|
| `ScriptedDecisionNode.script` (or any node where `journeyNodeNeedsScript()` returns true — `useScript !== false` plus a `script` id) | Pulled via `exportScriptById` (one GET per script) |
| `InnerTreeEvaluatorNode.tree` | Recursive `processJourneys(...)` call — but **only when `-n` is set**. The check at `journeys.js:131-135` is `!!name && pullDependencies && _type._id === "InnerTreeEvaluatorNode"`. Bulk pulls do not recurse. |

**Not followed from the journey pull**:
- Email templates
- SAML2 entities and circles of trust
- Social IdPs and their transform scripts
- Themes
- Library scripts (scripts that one script imports from another)
- Custom designer node types
- ESVs

These are pulled by **separate commands** (`email-templates`, `saml`, `themes`, `social-idp`, `services`, etc.). fr-config-manager's mental model is one config domain per command; users compose them into a full pull pipeline. This is narrower than frodo and closer to the UI's export.

`journeyNodeNeedsScript` (`fr-config-common/src/utils.js:98-102`):

```js
function journeyNodeNeedsScript(node) {
  return !!node.script && node.useScript !== false;
}
```

---

## On-disk output layout — the headline difference

```
<CONFIG_DIR>/
  <realm>/
    journeys/
      <safe(treeId)>/
        <treeId>.json                                # tree skeleton (the list-call result)
        nodes/
          <safe("<displayName> - <nodeId>")>.json    # one file per regular node
          <safe("<displayName> - <nodeId>")>/        # directory for a PageNode
            <safe("<childName> - <childId>")>.json   # one file per child of the PageNode
    scripts/
      scripts-content/
        <context>/                                   # e.g. AUTHENTICATION_TREE_DECISION_NODE
          <safe(scriptName)>.js                      # DECODED script body, plain JS
      scripts-config/
        <scriptUuid>.json                            # script metadata; "script" replaced by:
                                                     #   { "file": "scripts-content/<context>/<name>.js" }
```

The transformation that creates the `.js` files is at `scripts.js:31-53`:

```js
const buff = Buffer.from(script.script, "base64");
const source = buff.toString("utf-8");
fs.writeFileSync(`${scriptContentPath}/${scriptFilename}`, source);
script.script = { file: `${scriptContentRelativePath}/${scriptFilename}` };
```

**Implications**:
- **Git-diff-friendly.** Single-node edits show up as single-file changes; script changes diff as real JS. The PAIC UI / frodo bundles diff as huge JSON blobs.
- **Reimporting is non-trivial.** The on-disk form is NOT API-shaped — the push command (`fr-config-push`) has to re-base64 the `.js` file and inline it back into the script JSON before PUT. (Out of scope for this finding; relevant for future POCs.)
- **`_id` and `_rev` are kept** in node/tree/script JSONs (the deepSort utility at `utils.js:18-35` sorts keys but doesn't strip metadata).
- **No `meta` block.** Nothing identifies the export tool or timestamp on disk. Just files.
- **PageNode children are physically nested** under the parent's directory — preserves the visual hierarchy.

Filename collisions: handled implicitly by including `nodeId` (the uuid) in the name — `<displayName> - <uuid>.json`. If two nodes share a name, the uuid keeps them separate. `safeFileName()` (`fr-config-common/src/utils.js`) sanitises path-unsafe chars.

---

## Auth model

`packages/fr-config-common/src/authenticate.js`:

- **Service-account JWT-bearer** (CLOUD deployments, default) — signs a JWT with `SERVICE_ACCOUNT_KEY` (PEM or JWK), exchanges at `/am/oauth2/access_token`. Same flow as aic-pipeline and frodo.
- **Superadmin user/password** (PLATFORM / on-prem deployments) — `SUPERADMIN_USERNAME` + `SUPERADMIN_PASSWORD`.
- **Pre-supplied token** — set `FCM_ACCESS_TOKEN` env var to skip the mint step (useful for short-lived debugging).
- Deployment mode is selected by `DEPLOYMENT_TYPE` env var (default `CLOUD`).

Token is fetched **once per CLI invocation** and reused across all calls (no per-call refresh).

---

## Config env vars consumed by `journeys` pull

From `index.js` `getConfig()`:

| Var | Purpose |
|---|---|
| `TENANT_BASE_URL` | tenant origin |
| `REALMS` | JSON array of realm names to iterate (e.g. `["alpha"]`) |
| `CONFIG_DIR` | output directory; defaults to `cwd()` |
| `SERVICE_ACCOUNT_CLIENT_ID` | OAuth client id used for JWT-bearer exchange |
| `SERVICE_ACCOUNT_ID` | SA subject id |
| `SERVICE_ACCOUNT_KEY` | JWK or PEM for signing the JWT |
| `SERVICE_ACCOUNT_SCOPE` | requested scope (e.g. `fr:am:* fr:idm:*`) |
| `DEPLOYMENT_TYPE` | optional, default `CLOUD` |
| `FCM_ACCESS_TOKEN` | optional, skip token mint |
| `CUSTOM_HEADERS` | optional global headers |
| `SCRIPT_PREFIXES` | only used by the standalone `scripts` command, not `journeys` |

aic-pipeline reuses the first six (it just renames a couple in its `.env` parser).

---

## Parallelism

**Strictly sequential.** Every loop uses plain `await` inside `for...of`. No `Promise.all` anywhere in `journeys.js` or `scripts.js`. For a realm with hundreds of journeys this is noticeably slower than frodo or the UI; the trade-off is that the call-volume per tree is smaller because of `_queryFilter=true` caching.

The `nodeCache` is at function scope inside `processJourneys`, so the cache lifetime is one realm pull. Calling fr-config-pull twice in a row will re-fetch all node types.

---

## What this means for the POC

| Question | Answer |
|---|---|
| Same REST calls as UI/frodo? | Partly — script endpoint identical; tree skeleton is via the list call, not per-id; **nodes use a fundamentally different shape** (`?_queryFilter=true` per type vs. per uuid). |
| Same output? | No — directory tree, one JSON per node, scripts as `.js`. Not a bundle. Not easily diffable against the UI bundle. |
| Same dependency expansion? | Narrower than frodo. Roughly matches the UI's export footprint, plus inner-tree recursion (only with `-n`). |
| Auth flow? | Service-account JWT-bearer, same as frodo and aic-pipeline. |
| Performance characteristics? | Fewer REST calls per tree (T calls for T node types), but no parallelism. For one or two journeys, slower than the UI. For dozens of journeys in a realm with overlapping node types, the cache pays off. |
| Headline behavioural quirk | If you do `journeys -d` *without* `-n`, inner-tree recursion does NOT happen. Caller needs to know to either drive it per-name or also run `journeys` for the referenced inner trees explicitly. |

---

## File index for follow-up

| Concern | File | Lines |
|---|---|---|
| CLI dispatcher | `packages/fr-config-pull/src/index.js` | 220–240 |
| Journeys logic | `packages/fr-config-pull/src/scripts/journeys.js` | 15–193 |
| Scripts logic | `packages/fr-config-pull/src/scripts/scripts.js` | 31–148 |
| `journeyNodeNeedsScript` | `packages/fr-config-common/src/utils.js` | 98–102 |
| REST client | `packages/fr-config-common/src/restClient.js` | 110–309 |
| Auth | `packages/fr-config-common/src/authenticate.js` | 31–92 |
| `COMMAND.AUTH_TREE` constant | `packages/fr-config-common/src/constants.js` | 36 |
