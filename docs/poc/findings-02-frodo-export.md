# Finding 02 — How frodo exports journeys

**Date:** 2026-05-15
**Source:** `frodo/frodo-cli/` and `frodo/frodo-lib/` (rockcarver, MIT)
**Reference command:** `frodo journey export -i <journeyId> [--no-deps] [--use-string-arrays] [--no-coords] [--no-metadata]`

---

## Summary

`frodo` is a CLI on top of `frodo-lib`. For journey export it hits the **same three endpoint families as the PAIC UI** (trees / nodes / scripts), but with two notable divergences:

1. **Node endpoint shape is shorter** — `.../nodes/<NodeType>/<uuid>` (no version segment) with `Accept-API-Version: protocol=2.1,resource=1.0`. The UI uses `.../nodes/<NodeType>/<version>/<uuid>` with `resource=3.0`. **Both shapes work and return byte-identical responses** — verified by live test against this tenant.
2. **frodo expands dependencies much more aggressively** than the UI's export — themes, email templates, social IdPs, SAML2 entities + circles of trust, library scripts, custom node types. The UI export populates these container keys as empty `{}`/`[]` unless directly referenced in the captured trees.

Output is the same shape conceptually (`{ meta, ... }`), with one wrapping difference at the CLI level.

---

## CLI surface

`frodo-cli/src/cli/journey/journey-export.ts:1-139` defines three mutually exclusive export modes:

| Flag | Mode | CLI op called |
|---|---|---|
| `-i <id>` | one journey | `exportJourneyToFile()` (CLI op `JourneyOps.ts:158`) |
| `-a` | all journeys → one bundle | `exportJourneysToFile()` (CLI op `JourneyOps.ts:216`) |
| `-A` | all journeys → one file per journey | `exportJourneysToFiles()` (CLI op `JourneyOps.ts:247`) |

Key option flags:

| Flag | Effect |
|---|---|
| `--no-deps` | Skip scripts, email templates, SAML, social IdPs, themes, library scripts |
| `--use-string-arrays` | Script body returned as array of lines (instead of base64) |
| `--no-coords` | Drop `x`/`y` from nodes |
| `--no-metadata` | Omit the `meta` block |

The CLI op forwards to lib's `exportJourney()`. For single-journey export the CLI then **wraps** the lib's result as `{ trees: { [id]: <singleExport> } }` (`frodo-cli/src/ops/JourneyOps.ts:186`) so the on-disk file looks like the multi-journey bundle even when one journey was exported.

---

## Lib-side: the core export function

`frodo-lib/src/ops/JourneyOps.ts:800` — `exportJourney({ journeyId, options, state })` is the orchestrator. It runs four BFS-style waves:

```
Wave 1: GET the tree skeleton
Wave 2: GET every node referenced in tree.nodes (parallel via Promise.all)
Wave 3: For container nodes (PageNode, CustomPageNode), GET each inner node
        (parallel via Promise.allSettled at line ~1036)
Wave 4: For each dependency class flagged by node type:
          - ScriptedDecisionNode  → GET script, then recurse into library scripts
          - SocialProviderHandlerNode / SelectIdPNode → fetch social IdPs + their transform scripts
          - product-Saml2Node     → fetch saml2 entities + circles of trust
          - email-template nodes  → fetch templates
          - PageNode.stage themeId / tree.linkedTrees → fetch themes
        All within-class fetches are Promise.all
```

This is the **same two-wave shape as the UI's HAR** for trees/nodes/scripts, plus a much wider set of optional Wave-4 fetches when `--deps` is on (the default).

---

## The actual REST calls

### Tree

```
GET /am/json/{realmPath}/realm-config/authentication/authenticationtrees/trees/{id}
Accept-API-Version: protocol=2.1,resource=1.0
```
Source: `frodo-lib/src/api/TreeApi.ts:16` (`apiVersion`), invoked from `JourneyOps.ts:820` via `getTree()`.

**Same as UI.**

### Node

```
GET /am/json/{realmPath}/realm-config/authentication/authenticationtrees/nodes/{NodeType}/{uuid}
Accept-API-Version: protocol=2.1,resource=1.0
```
Source: `frodo-lib/src/api/NodeApi.ts:21-22` (`nodeURLTemplate = '.../nodes/%s/%s'`), `NodeApi.ts:34` (apiVersion), invoked from `getNode()` at `NodeApi.ts:205`.

**Different from UI**, which uses `.../nodes/{NodeType}/{version}/{uuid}` with `resource=3.0`.

**Live test on the captured tenant** (both shapes against the same `WebAuthnAuthenticationNode`):

```
UI shape    GET .../nodes/WebAuthnAuthenticationNode/1.0/<uuid>  Accept-API-Version: protocol=2.1,resource=3.0  → 200, 600 B
frodo shape GET .../nodes/WebAuthnAuthenticationNode/<uuid>      Accept-API-Version: protocol=2.1,resource=1.0  → 200, 600 B
diff: <empty — byte-identical response>
```

So in practice AM happily accepts either form. The version segment + `resource=3.0` look like a UI-side convention rather than a hard requirement.

### Script

```
GET /am/json/{realmPath}/scripts/{uuid}
Accept-API-Version: protocol=2.0,resource=1.0
```
Source: `frodo-lib/src/api/ScriptApi.ts:14`. **Same as UI.**

Script body format depends on `--use-string-arrays`:
- default → base64 single string (the raw API format)
- `--use-string-arrays` → decoded and split into `string[]` for readable diffs

Code: `frodo-lib/src/ops/JourneyOps.ts:1299-1342` (script collection); the convert call is around line 1311-1314.

### Additional dependency endpoints (Wave 4)

frodo invokes these only when `--deps` is on (default) AND the node types are present:

| Trigger | Endpoint(s) called |
|---|---|
| `product-Saml2Node` | reads SAML2 provider stubs + Circles of Trust via `readSaml2ProviderStubs()` / `readCirclesOfTrust()` (`JourneyOps.ts:950-975`) |
| `SocialProviderHandlerNode` / `SelectIdPNode` | reads all social IdPs (`JourneyOps.ts:982-994`); for each, fetches the transform script (`JourneyOps.ts:1280`) |
| email-template-bearing nodes | `readEmailTemplate()` (`JourneyOps.ts:928-947`, `1073-1087`) |
| themed `PageNode.stage` or `tree.linkedTrees` | reads all themes, filters by ref (`JourneyOps.ts:1370-1397`) |
| `_type._id.startsWith('designer-')` | fetches the custom node type from `/json/node-designer/node-type/{type}` |
| `ScriptedDecisionNode.script` whose body imports other scripts | recurses into library scripts (`JourneyOps.ts:1318-1332`) |

The UI's exporter does NONE of this beyond ScriptedDecisionNode.script. That's the biggest behavioral gap.

---

## Output bundle shape

Lib-side single-journey export (`SingleTreeExportInterface`, `frodo-lib/src/ops/JourneyOps.ts:502-516`):

```jsonc
{
  "meta": {
    "origin":           "https://<tenant>",
    "originAmVersion":  "<discovered>",
    "exportedBy":       "<username or sa id>",
    "exportDate":       "<iso>",
    "exportTool":       "frodo",
    "exportToolVersion": "<frodo-lib version>"
  },
  "tree":      <tree skeleton, _id/_rev preserved>,
  "nodes":             { "<uuid>": <node>, ... },
  "innerNodes":        { "<uuid>": <node>, ... },
  "scripts":           { "<uuid>": <script>, ... },
  "emailTemplates":    { ... },
  "socialIdentityProviders": { ... },
  "themes":            [ ... ],            // array, not record
  "saml2Entities":     { ... },
  "circlesOfTrust":    { ... },
  "variable":          { ... },            // ESVs referenced by scripts
  "nodeTypes":         { ... }             // custom node defs
}
```

The CLI then wraps single exports as `{ "trees": { "<id>": <singleExport> } }` (`frodo-cli/src/ops/JourneyOps.ts:186`), so the file on disk looks like the multi-tree shape.

### Comparison with the UI bundle

| Key | UI export | frodo (CLI on disk) |
|---|---|---|
| `meta.exportTool` | `"platform-admin ui tree export"` | `"frodo"` |
| `meta.exportToolVersion` | `"1.1"` | frodo-lib version |
| `meta.originAmVersion` | absent | present |
| `meta.innerTreesIncluded` | present (top-level meta) | absent at top-level (per-tree `_id`s in `trees`) |
| Top-level wrapping | `{ meta, trees: { id: { tree, nodes, ... } } }` | same (`{ trees: { id: { tree, nodes, ... } } }`) |
| Single vs all | always wrapped | wrapped to look the same regardless of -i vs -a |
| `_id`/`_rev` on tree | kept | kept |
| `themes` | `[]` (empty array) | populated array if any node references a themeId |
| `saml2Entities` / `circlesOfTrust` | `{}` | populated if any SAML2 node present |
| `emailTemplates`, `socialIdentityProviders` | `{}` | populated when referenced |
| `variable` (ESVs) | absent | present when scripts reference ESVs |
| `nodeTypes` (custom designer-* nodes) | absent | present when used |
| Scripts | base64 single string (raw API form) | base64 string OR `--use-string-arrays` |

### File naming on disk (frodo CLI)

| Mode | Filename |
|---|---|
| `-i <id>` | `<journeyId>.journey.json` |
| `-a` | `all<RealmString>Journeys.journey.json` |
| `-A` | one file per journey, each `<journeyId>.journey.json` |

(`frodo-cli/src/ops/JourneyOps.ts:171, 227, 264`)

---

## Auth model

`frodo-lib` supports two flows, configured on the shared `State`:

1. **Username + password** — admin user session. Sets `withCredentials: true` so the AM SSO cookie rides along.
2. **Service Account (recommended for AIC)** — `setServiceAccountId()` + `setServiceAccountJwk()` + `setUseBearerTokenForAmApis(true)`. frodo-lib signs a JWT with the JWK, exchanges it at `/am/oauth2/access_token` for a bearer token, then attaches `Authorization: Bearer <token>` to every call. Token auto-refresh is built in.

Both paths are transparent to the export code — selection happens at the HTTP layer in `BaseApi.ts`.

---

## Parallelism

- Within one journey: nodes, inner nodes, scripts each batched with `Promise.all` / `Promise.allSettled`. Same shape as the UI's parallel fan-out.
- Across journeys (`-a`/`-A`): the outer loop in `exportJourneys()` (`JourneyOps.ts:1447`) iterates journeys sequentially. Within each journey, fan-out is parallel.
- No explicit throttling — relies on axios-retry config.

---

## How frodo differs from the PAIC UI export

| Dimension | UI | frodo |
|---|---|---|
| Tree endpoint | identical | identical |
| Node endpoint URL | `.../nodes/<Type>/<version>/<uuid>` | `.../nodes/<Type>/<uuid>` |
| Node Accept-API-Version | `protocol=2.1,resource=3.0` | `protocol=2.1,resource=1.0` |
| Script endpoint | identical | identical |
| Auth | AM SSO cookie | Bearer (service account JWT) or session cookie |
| Dependency scope | tree + nodes + scripts only | tree + nodes + scripts **+** themes, email templates, social IdPs + their scripts, SAML2 entities, CoT, library scripts, custom node types, ESVs |
| Script format options | none (base64 string) | base64 OR string-array |
| Coordinate stripping | no option | `--no-coords` |
| Metadata stripping | no option | `--no-metadata` |
| Top-level shape | `{ meta, trees: { id: { tree, nodes, innerNodes, scripts, emailTemplates, socialIdentityProviders, themes, saml2Entities, circlesOfTrust } } }` | same shape; adds `variable`, `nodeTypes`; arrays/maps populated more aggressively |
| `exportTool` tag | `"platform-admin ui tree export" v1.1` | `"frodo" v<lib>` |
| Inner-tree recursion | yes (records in `meta.innerTreesIncluded`) | yes (recurses; uses `tree.linkedTrees`) |

---

## Do we need to run frodo end-to-end?

Probably not for the export-call-shape comparison — the code paths above are authoritative, and we just verified that **frodo's node-URL form returns the same byte-for-byte payload as the UI's form**. The only thing a live run buys us is:

1. **Empirical bundle for diffing.** If we want a side-by-side `diff -u <ui-bundle> <frodo-bundle>` for the two webauth journeys, we'd need to run frodo against the same tenant.
2. **Confirm the dependency expansion actually fires** for these particular journeys (e.g. do they reference any themes/ESVs the UI export missed?).
3. **Validate the service-account auth path** end-to-end before we depend on it.

If a live run is wanted, we'd need a service-account credential for the tenant. Without it, the code map above is enough to build a reference exporter for the POC.

---

## File index for follow-up

| Concern | File | Lines |
|---|---|---|
| CLI command | `frodo-cli/src/cli/journey/journey-export.ts` | 1–139 |
| CLI delegate | `frodo-cli/src/ops/JourneyOps.ts` | 158–282 |
| Core export | `frodo-lib/src/ops/JourneyOps.ts` | 800–1418 |
| Tree GET | `frodo-lib/src/api/TreeApi.ts` | 9–111 |
| Node GET | `frodo-lib/src/api/NodeApi.ts` | 21–228 |
| Script GET | `frodo-lib/src/api/ScriptApi.ts` | 8–140 |
| Export types | `frodo-lib/src/ops/JourneyOps.ts` | 502–521 |
| Metadata | `frodo-lib/src/utils/ExportImportUtils.ts` | 246 |
