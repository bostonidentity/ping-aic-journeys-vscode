# Sidebar Tree Structure

> Visual reference for the left-bar tree (`paicJourneys.connections` view). For the rationale and locked decisions, see [design-plan.md](design-plan.md). For phase status, see [progress.md](progress.md).

## Shape

```
▼ connection: prod-tenant                  [L1]
  ▼ realm: alpha                           [L2]
    ▼ journey: Login                       [L3]
      📜 script: MyAuthDecision            [L4]
        📜 library-script: helpers         [L5 — recursive via require()]
      🌲 inner journey: PasswordReset      [L4 — recursive shape below]
        📜 script: ResetSender             [L5]
        🌲 inner journey: VerifyEmail      [L5]
          📜 script: ...                   [L6 — recurses indefinitely]
          🌲 inner journey: ...
      🎨 theme: default                    [L4]
      $ esv: TENANT_NAME                   [L4]
    ▶ journey: Registration
  ▶ realm: beta
▶ connection: stage-tenant
```

## Levels

| Level | Item | Source | Notes |
|---|---|---|---|
| **L1** | Connection | `paicJourneys.connections` setting | `host` is the stable ID; `name` is an optional display label. JWK lives in SecretStorage. |
| **L2** | Realm | `GET /am/json/global-config/realms` (or fixed list) | Almost always `alpha` + `beta`. Single-realm tenants auto-expand. |
| **L3** | Journey | `GET /am/json/<realm>/realm-config/authentication/authenticationtrees/trees` | One root journey = one resolver entry point. |
| **L4** | Direct dependency | Resolver output for that journey | Children depend on `kind` — see next section. |
| **L5+** | Transitive deps | Resolver recurses | Cycle-guarded via visited-set keyed by `(kind, id)`. |

## Dependency kinds at L4+

| Icon | `NodeKind` | Source | Recurses into |
|---|---|---|---|
| 📜 | `script` | `ScriptedDecisionNode.script` → `/am/json/<realm>/scripts/<id>` | Library scripts via `require()` calls in script body |
| 📜 | `library-script` | Found via `require()` in any script body | Other library scripts (depth-N) |
| 🌲 | `inner journey` | `InnerTreeEvaluatorNode` in tree skeleton | Full journey expansion (same L3 shape recursively) |
| 🎨 | `theme` | `Page.stage` / theme config | Leaf today |
| $ | `esv` | `&{esv...}` / `systemEnv.X` patterns in script body | Leaf |

Phase-2 resolver walks **all** kinds. The tree view may hide kinds behind a filter toggle in later phases (default-on for scripts + inner journeys, default-off for themes/ESVs until they earn their screen real estate).

## Edge kinds (for the graph view, not visible in the tree)

- `contains` — journey ⟶ node
- `calls-inner-tree` — journey ⟶ inner journey
- `invokes-script` — node ⟶ script
- `imports-library` — script ⟶ library-script
- `references-esv` — script ⟶ esv
- `uses-theme` — journey ⟶ theme

## Lazy expansion

Each level fetches on demand:
- **Click connection** → fetch realm list.
- **Click realm** → fetch journey list (paginated via `pagedResultsCookie`).
- **Click journey** → fetch tree skeleton + node payloads; resolver builds L4+.
- **Click inner journey** → resolver recurses; shows cached result on re-expand within the session.

Per-session memoization keyed by `(connection-host, realm, kind, id)`. No on-disk persistence yet.

## Cycle handling

Visited-set keyed by `(kind, id)`. On second visit to the same node within one walk, emit a `[cycle]` placeholder leaf instead of re-expanding. Logged at `DEBUG`.
