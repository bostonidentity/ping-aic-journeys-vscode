# Finding 01 — How the PAIC Admin UI exports journeys

**Date:** 2026-05-15
**Tenant:** `openam-tenant.example.forgeblocks.com`
**Realm:** `alpha`
**Source artifact:** `paic-ui/openam-tenant.example.forgeblocks.com.har`
**Export artifact:** `paic-ui/multiple-journeysExport-alpha-realm-...-2026-05-15T14_46_23.210Z.json`
**Journeys exported:** `webauth_login_example`, `webauth_register_example`

---

## Summary

When the PAIC admin UI exports journeys, it does **not** call a single bulk-export endpoint. Instead, it fans out a small swarm of REST calls against three endpoint families and assembles the bundle in the browser. The export is fully client-side.

For 2 journeys the UI made **18 REST calls** completing in ~140 ms:

- 2 tree skeleton GETs
- 14 node payload GETs (incl. recursive descent into `PageNode` children)
- 2 script body GETs

The result is wrapped in a thin `{ meta, trees }` envelope with the tool tag `platform-admin ui tree export` (version `1.1`).

---

## The three endpoint families

| # | Endpoint | API Version | Purpose |
|---|---|---|---|
| 1 | `GET /am/json/realms/root/realms/{realm}/realm-config/authentication/authenticationtrees/trees/{treeId}` | `protocol=2.1,resource=1.0` | Tree skeleton — references nodes by UUID only |
| 2 | `GET /am/json/realms/root/realms/{realm}/realm-config/authentication/authenticationtrees/nodes/{NodeType}/{version}/{uuid}` | `protocol=2.1,resource=3.0` | Full node payload (settings + outcomes) |
| 3 | `GET /am/json/{realm}/scripts/{uuid}` | `protocol=2.0,resource=1.0` | Script body referenced by `ScriptedDecisionNode.script` |

Notes:

- **Three different `Accept-API-Version` values** — sending the wrong one will 400. Trees and nodes share `protocol=2.1` but `resource` differs (`1.0` vs `3.0`). Scripts use `protocol=2.0`.
- **Auth:** the UI does NOT use `Authorization: Bearer ...`. It uses the AM SSO **session cookie**. The cookie's name is *per-tenant random* — discover via `GET /am/json/serverinfo/*` → `cookieName` field. On this tenant the name is `9ed2dc164aff213`, **not** `iPlanetDirectoryPro`.

---

## Call pattern (timing)

All 18 calls completed in roughly 140 ms, with heavy parallelism:

```
T+0ms    GET trees/webauth_login_example                          ← tree 1
T+1ms    GET trees/webauth_register_example                       ← tree 2
         ── ~60ms gap while UI parses tree responses ──
T+64ms   GET nodes/SetSuccessUrlNode/1.0/<uuid>
T+64ms   GET nodes/WebAuthnAuthenticationNode/1.0/<uuid>
T+64ms   GET nodes/PageNode/1.0/<uuid>                           ← outer page
T+64ms   GET nodes/PageNode/1.0/<uuid>                           ← outer page
T+64ms   GET nodes/WebAuthnDeviceStorageNode/1.0/<uuid>
T+65ms   GET nodes/WebAuthnRegistrationNode/1.0/<uuid>
T+65ms   GET nodes/MessageNode/1.0/<uuid>
T+65ms   GET nodes/ScriptedDecisionNode/1.0/<uuid>               ← reveals script ref
T+65ms   GET nodes/ScriptedDecisionNode/1.0/<uuid>               ← reveals script ref
T+65ms   GET nodes/SetSuccessUrlNode/1.0/<uuid>
T+65ms   GET nodes/PageNode/1.0/<uuid>                           ← outer page
         ── ~70ms gap, second wave (recursed into PageNodes) ──
T+136ms  GET nodes/AttributeCollectorNode/1.0/<uuid>             ← child of PageNode
T+137ms  GET scripts/<uuid>                                      ← from ScriptedDecisionNode
T+137ms  GET scripts/<uuid>                                      ← from ScriptedDecisionNode
T+137ms  GET nodes/MessageNode/1.0/<uuid>                        ← child of PageNode
T+137ms  GET nodes/MessageNode/1.0/<uuid>                        ← child of PageNode
```

The wave structure shows the UI's algorithm: **fetch trees → parse refs → fetch all referenced nodes in parallel → parse for further refs (page children, script ids) → fetch those in parallel**. Two BFS waves total.

---

## Algorithm (reconstructed from the wave order + the export bundle)

```
1. For each selected tree:
     GET /am/json/.../authenticationtrees/trees/{treeId}
   Tree JSON has the shape:
     {
       "_id", "_rev",
       "identityResource", "entryNodeId",
       "innerTreeOnly", "noSession", "mustRun", "enabled", "transactionalOnly",
       "uiConfig", "staticNodes",
       "nodes": {
         "<nodeUuid>": {
           "connections": { "<outcomeName>": "<nextNodeUuid>", ... },
           "displayName", "nodeType", "version",
           "x", "y"
         }
       }
     }
   (Note: tree.nodes carries ONLY references — no node settings, no script bodies.)

2. Collect the set of (nodeType, version, uuid) tuples from tree.nodes.
   Fetch each in parallel:
     GET /am/json/.../authenticationtrees/nodes/{nodeType}/{version}/{uuid}
   Node JSON has the shape:
     {
       "_id", "_rev",
       <type-specific settings>,
       "_type": { "_id": "<NodeType>", "name": "...", "collection": true, "version": "1.0" },
       "_outcomes": [ { "id": "...", "displayName": "..." }, ... ]
     }

3. While walking node payloads, discover two more reference kinds:

   a. PageNode.nodes — array of child node refs:
        "nodes": [ { "_id": "<uuid>", "nodeType": "...", "displayName": "..." } ]
      → fetch each child node via the same /nodes/ endpoint. These end up in the
        export bundle under "innerNodes" (not "nodes").

   b. ScriptedDecisionNode.script — string UUID:
        "script": "00000000-0000-0000-0000-000000000001"
      → GET /am/json/{realm}/scripts/{uuid}

   (Other node types contribute other reference kinds — InnerTreeEvaluatorNode
    triggers a recursive tree export; SAML/SocialIdp nodes pull from yet other
    endpoints. None of those were exercised by this export.)

4. Assemble the bundle:
   {
     "meta": { origin, exportedBy, exportDate, exportTool, exportToolVersion,
               treesSelectedForExport: [...], innerTreesIncluded: [...] },
     "trees": {
       "<treeId>": {
         "tree":                  <step 1 response, verbatim>,
         "nodes":                 { <uuid>: <step 2 response>, ... },   // direct refs
         "innerNodes":            { <uuid>: <step 3a response>, ... },  // PageNode children
         "scripts":               { <uuid>: <step 3b response>, ... },
         "emailTemplates":        {},
         "socialIdentityProviders": {},
         "themes":                [],
         "saml2Entities":         {},
         "circlesOfTrust":        {}
       }
     }
   }
```

Empty containers (`emailTemplates`, `themes`, etc.) are always present even when no references exist — the schema is fixed.

---

## Important REST calls captured in the HAR

Tenant base URL omitted for brevity: `https://openam-tenant.example.forgeblocks.com`

### 1. Tree skeletons (2 calls)

```
GET /am/json/realms/root/realms/alpha/realm-config/authentication/authenticationtrees/trees/webauth_login_example
GET /am/json/realms/root/realms/alpha/realm-config/authentication/authenticationtrees/trees/webauth_register_example

Headers:
  Accept: application/json, text/plain, */*
  Accept-API-Version: protocol=2.1,resource=1.0
  If-None-Match: "<known _rev>"      (optional — used by UI for caching)
  Cookie: <tenantCookieName>=<sessionToken>
```

`webauth_login_example` returned 3 nodes; `webauth_register_example` returned 8 nodes.

### 2. Node payloads (14 calls)

```
GET /am/json/realms/root/realms/alpha/realm-config/authentication/authenticationtrees/nodes/{NodeType}/{version}/{uuid}

Headers:
  Accept-API-Version: protocol=2.1,resource=3.0
  Cookie: <tenantCookieName>=<sessionToken>
```

Node type breakdown across both trees:

| Node type | Count |
|---|---|
| PageNode | 3 |
| MessageNode | 3 |
| SetSuccessUrlNode | 2 |
| ScriptedDecisionNode | 2 |
| WebAuthnAuthenticationNode | 1 |
| WebAuthnDeviceStorageNode | 1 |
| WebAuthnRegistrationNode | 1 |
| AttributeCollectorNode | 1 |

Of these, 2 (AttributeCollectorNode + 1 MessageNode) were discovered as `PageNode` children in the second wave.

### 3. Script bodies (2 calls)

```
GET /am/json/alpha/scripts/00000000-0000-0000-0000-000000000001   # webauth_deviceNameCollector_script
GET /am/json/alpha/scripts/00000000-0000-0000-0000-000000000002   # webauth_getUsernameFromEmail_script

Headers:
  Accept-API-Version: protocol=2.0,resource=1.0
  Cookie: <tenantCookieName>=<sessionToken>
```

Both belong to `webauth_register_example` (its two `ScriptedDecisionNode`s). The login tree had zero scripts.

### 4. NOT part of the export flow

These appear in the HAR but happen at page-load time, not during the export click:

- `GET .../authenticationtrees/trees?_queryFilter=true&_pageSize=-1` — journey list rendering
- `POST .../authenticationtrees/trees?_action=template` — used by the "Create journey" affordance
- `POST .../realm-config/authentication?_action=schema` — schema fetch for the editor
- `GET .../am/oauth2/authorize?prompt=none&...` — silent OIDC reauth for the IDM admin client; this issues an `id_token` for `idmAdminClient` with scope `fr:idm:*`. **NOT used to authenticate the AM REST calls** — those rely solely on the AM session cookie.

---

## Replay verification

Confirmed both call families replay successfully with just the AM session cookie:

```
GET .../authenticationtrees/trees/webauth_login_example                                  → HTTP 200, 1326 bytes
GET .../authenticationtrees/nodes/WebAuthnAuthenticationNode/1.0/20025521-...           → HTTP 200, 600 bytes
```

Both responses byte-identical to the HAR captures (same `_rev`).

Files: `replay-tree.json`, `replay-node.json`.

---

## Auth gotchas worth remembering for the POC

1. **The bearer token in the HAR is useless for AM REST.** The HAR includes an `id_token` for `idmAdminClient` (scope `fr:idm:*`), but it's for IDM only and got 401 against the AM tree endpoint.
2. **Cookie name is per-tenant random.** Always discover via `GET /am/json/serverinfo/*` → `cookieName`. Hard-coding `iPlanetDirectoryPro` will fail on AIC.
3. **The HAR strips `Cookie` headers by default.** Chrome's "Save as HAR" omits cookie values for security. To replay, the cookie must be re-captured from a live browser session (or replaced with a service-account access token).
4. **Service-account JWT-bearer is the right answer for scripted clients.** Mint a JWT with the SA's JWK, exchange at `/am/oauth2/access_token` for a bearer token, then use `Authorization: Bearer ...`. This is the flow aic-pipeline / frodo / fr-config-manager all use.

---

## Bundle shape quick reference

```jsonc
{
  "meta": {
    "origin": "https://.../platform/?realm=alpha#/journeys",
    "exportedBy": "<user email>",
    "exportDate": "2026-05-15T14:46:23.210Z",
    "exportTool": "platform-admin ui tree export",
    "exportToolVersion": "1.1",
    "treesSelectedForExport": ["webauth_login_example", "webauth_register_example"],
    "innerTreesIncluded": []
  },
  "trees": {
    "<treeId>": {
      "tree":                   { ... },        // step-1 response, verbatim
      "nodes":                  { "<uuid>": { ... } },  // direct refs from tree
      "innerNodes":             { "<uuid>": { ... } },  // PageNode children
      "scripts":                { "<uuid>": { ... } },  // ScriptedDecisionNode refs
      "emailTemplates":         {},
      "socialIdentityProviders": {},
      "themes":                 [],
      "saml2Entities":          {},
      "circlesOfTrust":         {}
    }
  }
}
```

`_id` and `_rev` are preserved (NOT stripped). The bundle is intended to be re-imported via the same UI's import flow, which presumably handles `_rev` conflicts on its own.

---

## Next steps for the POC

- Replay the full UI flow as a Node script to produce a byte-equivalent bundle from a service-account credential (reference implementation).
- Run `frodo journey export` against the same two journeys and diff the bundle against the UI's export.
- Run `fr-config-manager pull --journeys` and observe its on-disk layout — expected to differ structurally (directory tree, one JSON per node), not as a single bundle file.
- Compare: number of REST calls, parallelism, bundle shape, `_rev` handling, script handling, inner-tree recursion behavior.
