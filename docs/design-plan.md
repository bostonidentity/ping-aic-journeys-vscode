# PAIC Journeys (VS Code Extension) — Design Plan

> Single source of truth for what we're building and why. Companions: [progress.md](progress.md) for build status, [sidebar-tree.md](sidebar-tree.md) for the sidebar shape, [logging-spec.md](logging-spec.md) for the log contract, [lessons.md](lessons.md) for corrections.

## Concept

A VS Code extension that turns *"what does this PAIC journey actually depend on?"* into a first-class artifact. The user connects to one or more PAIC tenants, picks a journey, and gets:

1. A **lazy tree view** in the sidebar — connection → realm → journey → expand to direct dependencies (scripts, inner journeys, later themes/ESVs) → keep expanding to leaves.
2. A **graph webview** in the editor area — the resolved dependency graph rendered with ReactFlow.
3. A **query panel** — reverse lookups ("which journeys use this script?"), orphans ("scripts referenced by nothing"), and impact analysis ("if I change this script, what breaks?"). Driven by a per-realm index.

Read-only. No pull/push/promote. Service-account JWT-bearer auth. Multi-tenant, local-only.

## Why this is worth building

Surveyed tools that already touch journey dependencies (PAIC UI export, `frodo`, `fr-config-manager`, the `paic-pipeline` Next.js viewer). Each falls short in a specific way:

- **PAIC UI export** is fixed-shape JSON. Not a graph, not analyzable.
- **frodo** has the walking primitives but doesn't expose them as a queryable graph (its `getTreeDescendents` and `getLibraryScriptsRecurse` exist but aren't wired into the user-facing export).
- **fr-config-manager** produces a directory tree, narrower deps than frodo, sequential, no graph.
- **paic-pipeline** has the best per-journey viewer but it's one journey at a time — no transitive graph, no reverse lookup.

**The unfilled gap is the realm-scoped dependency graph as a queryable artifact.** Forward exploration (tree view) is table stakes; reverse lookups + orphans + impact are the differentiator. A POC scan against a sandbox tenant's `alpha` realm measured this concretely: 84 journeys, 1,061 calls, ~15 s at concurrency 10 — and one shared script touched by 55 of those 84 journeys. Today nobody sees that; tomorrow our tool surfaces it in seconds.

## Operating principles

These are the meta-rules that should survive any individual feature decision:

1. **Incremental end-to-end slices over horizontal layers.** Each milestone delivers a working, testable user-facing flow. We don't build an entire layer (client / resolver / tree / webview) in isolation and then wire it up at the end. The first slice is *narrow but complete*: one connection, one journey, scripts and inner-trees visible, script body openable. We add depth slice by slice.

2. **Foundation chosen so each new slice doesn't force a redesign.** The layered architecture (transport / domain / consumers), the tree-node class hierarchy, and the typed extension⇄webview message protocol are introduced *exactly when* the second consumer arrives — not earlier, not later. The price of doing them at the right moment is keeping the option open from milestone 1.

3. **Stateless start.** Reload = clean slate. No database, no on-disk cache of derived data, no journal of fetched payloads. Only user-owned config persists (connections + JWK). Same rationale as why we don't ship SQLite: simpler, safer, no staleness anxiety, no cache invalidation problem.

4. **Pay for what you use.** Browsing is lazy and per-click. The realm-skeleton scan that powers analysis features runs in the background only after the user expands a realm. Reverse-lookup queries don't fire until the user opens the query panel.

5. **Browsing ≠ analysis.** Tree view is for forward exploration. Query panel is for cross-cutting queries. They share the same index when present, but live on separate surfaces so neither clutters the other.

6. **Idea-debt over code-debt.** We borrow patterns from frodo-lib (scope fallback, retry, realm-path translation, node-type tables) but not the library itself. See D2.

## Locked decisions

### D1 — Stack

VS Code Extension API + TypeScript + esbuild bundle. No webpack. Webview UIs (when introduced) are React + ReactFlow as a separate esbuild entry point.

### D2 — Foundation: raw REST, not frodo-lib

Lifted ideas (auth flow, scope fallback, realm-path helper, pagination shape, node-type tables, retry interceptor) — no library dependency. Audit conclusion: the bits we'd actually use total ~250 lines of equivalent code; the bits we'd inherit but never use (IDM/SAML/social/IGA/agent/secret/theme/oauth-client/policy ops, file-I/O exporters, frodo's 809-line global `State` machine, Polly mocks) are 80%+ of frodo's surface. Architectural mismatch — frodo is CLI-shaped with a global mutable `State`, we want **per-connection** client instances — is the deciding factor. Plus frodo is pre-release (`4.0.0-42`) with API churn; pulling it in would force chasing upgrades.

### D3 — Storage: settings.json + SecretStorage, keyed by `host`

Per-connection: `host`, `saId`, optional `name` in `paicJourneys.connections` (settings.json). `saJwk` in `SecretStorage` keyed by `paicJourneys.saJwk.<host>`. Workspace-if-open else global target. No registry file in `globalStorageUri` — settings.json IS the registry. No master key or local encryption — `SecretStorage` (OS keychain) handles that. Failure modes worth handling: orphaned-settings-no-secret (sync to fresh machine) → "credentials missing" with right-click "Set Credentials"; secret-no-settings (manual edit gone wrong) → "Clean Up Orphaned Credentials" command, never auto-delete.

### D4 — `host` is the stable identity

Not a synthetic UUID, not a user-given name. Hosts are unique, stable, and human-meaningful. `name` is a pure display label, optional.

### D5 — "Connection" (not "tenant", not "environment")

User-facing vocabulary follows frodo's "connection profile" idea. Matches what the data actually is (a connected session against a host with creds). Avoids the "environment" overload from VS Code's own usage.

### D6 — Read-only

No pull, no push, no promote. If anyone wants those, they use paic-pipeline. We stay focused on analysis.

### D7 — Resolver: full-depth BFS with cycle guard

For each journey we *actually walk*: fetch tree skeleton → fetch reference-bearing node payloads → recurse on `InnerTreeEvaluatorNode.tree` → fetch script bodies on demand → (later) recurse on `require()` for library scripts → (later) extract ESV references from script bodies. Cycle guard via visited-set keyed by `(kind, id)`. Implementation grows by milestone (see Milestones below).

### D8 — In-memory only, no on-disk persistence of derived data

Token cache, resolver memo, RealmIndex — all in session memory. No `globalStorageUri/cache/*.json` writes for derived data. Reload = clean slate. Only user-owned config persists.

### D9 — Logging: structured NDJSON via pino, fanned out to file + Output panel

**Library:** [`pino`](https://github.com/pinojs/pino) (same choice as llm-gateway) + a small in-process `RotatingFileStream` for size-based rotation. Pino gives us ISO timestamps, level filtering, child loggers, error auto-serialization, and built-in `redact` paths for secrets. Boring, fast, well-known.

Rationale for in-process rotation (not `pino-roll`): pino-roll is implemented as a pino transport, which runs on a worker thread. `pino.multistream` — which we use to fan out to both the file and the Output panel — accepts only synchronous streams in its array, not worker-based transports. So pino-roll can't sit in the multistream. The ~50-line `RotatingFileStream` (`fs.openSync` + `fs.writeSync` + `fs.renameSync`) composes cleanly with multistream and avoids worker-thread fragility inside the Extension Host.

**Two sinks via `pino.multistream`:**
- **File:** `globalStorageUri/logs/paic-journeys.ndjson` — one JSON object per line, size-rotated at 5 MB × 5 files. This is what log shippers (Vector / Filebeat / Promtail / Loki / Datadog) tail.
- **Output panel:** a tiny `Writable` adapter parses each line and routes it to `vscode.window.createOutputChannel('PAIC Journeys', { log: true })` so users still get the friendly VS Code Output-panel UX.

**Why two sinks:** VS Code extensions can't usefully write to stdout (it's swallowed). We can't borrow llm-gateway's "Docker captures stdout" model directly. The file sink replaces stdout for log shipping; the channel sink preserves the in-editor UX.

**Record shape** (verbatim from llm-gateway's spec, adapted):

```jsonc
{ "time": "2026-05-17T15:23:45.123Z",
  "level": "info",
  "service": "paic-journeys",
  "version": "0.0.1",
  "component": "paic.http",      // from log.child({component: "paic.http"})
  "event": "http.request",       // categorical event name (namespace.action)
  "msg": "GET /trees status=200",// human-readable, no dynamic values
  "host": "openam-sb3...",       // arbitrary structured fields
  "status": 200,
  "duration_ms": 187 }
```

**Secret redaction** via pino's built-in `redact` paths:
```
["saJwk", "*.saJwk", "jwk", "*.jwk", "bearer", "assertion",
 "*.password", "*.token", "*.secret", "authorization"]
```
Matching values are replaced with `"[Redacted]"` before serialization. Recursive.

**Settings:**
- `paicJourneys.logging.level` — `error|warn|info|debug|trace`, default `info`.
- `paicJourneys.logging.fileEnabled` — boolean, default `true`. Privacy-conscious users can disable file sink and keep only the Output panel.

**Never log secrets** — the redact list is the safety net, but the rule still applies: avoid passing JWKs, tokens, or `SecretStorage` values into logger calls at all.

See [logging-spec.md](logging-spec.md) for the full field/event/level taxonomy.

### D10 — Never `process.exit()`

Anywhere. Throwing is the only way to fail in extension code.

### D11 — Data layer split (transport / domain / consumers)

Introduced at milestone M1.

```
src/paic/        TRANSPORT       Raw PAIC REST shapes; one-to-one with API.
                                Knows pagination, auth, retry, errors.
                                Returns PAIC envelopes — no reshape.

src/domain/     DOMAIN MODEL    Clean TS types: Connection, Realm, Journey,
                                Script, InnerJourney, Theme, ESV.
                                Decoupled from REST shape.

src/resolver/   ┐
src/views/      ├── CONSUMERS   Consume domain types only. Never raw REST.
src/webview/    ┘
```

Translation lives in mappers — `src/paic/mappers.ts` (open question: could move to `src/domain/from-paic.ts` later if "domain knows nothing about PAIC" purity matters more than locality).

### D12 — Tree-node class hierarchy at M1 (shipped)

Rationale at original lock-in: while the tree had only one level (connections), a plain interface + flat provider was correct. When the second level lands, refactor to `abstract class PaicNode` with one subclass per kind, each implementing `getChildren()` + tree-item rendering. Mirrors the database extension's `model/interface/node.ts` pattern.

**Shipped in M1**: cutover landed alongside the L2-L4 tree task. `src/views/nodes/{base,connection,realm,journey,inner-journey,script,journey-expand}.ts` implements the hierarchy; `PaicTreeProvider` delegates `getChildren` to each node and implements `getParent` so `TreeView.reveal()` can be driven from the inspector.

### D13 — RealmIndex: background skeleton scan on realm-expand

When a realm node is expanded, the tree populates instantly from `listJourneys` (~1 call). A background worker simultaneously walks every journey's skeleton + reference-bearing node payloads, building an in-memory `RealmIndex` keyed by `(host, realm)`. Measured cost: **~1,060 calls, ~15 s** at concurrency 10 for sb3's 84-journey realm.

Index contains:
- journey list with skeletons
- `journey → script` edges
- `journey → inner-journey` edges
- (later) `journey → theme`, `script → library-script`, `script → esv`
- inverted indexes for reverse lookups

In-memory only (per D8). Reload re-pays the scan on next realm-expand.

### D14 — Query panel: separate surface, multi-query

Reverse lookup / orphans / impact analysis live on a dedicated query panel (webview), opened via right-click on a realm or a top-bar button. Not inlined as badges in the tree. Same panel hosts all query types as tabs. Driven by the RealmIndex; if index isn't ready, panel shows "indexing… N/total" progress.

### D15 — Webview framework: React + esbuild, introduced at M1

One stack for all webviews (locked in by ReactFlow's React requirement for the graph view). Plain CSS using `--vscode-*` variables; revisit VSCode Elements / Tailwind only if surface grows. Second esbuild entry → `out/webview.js`. Typed message protocol in `src/webview/messages.ts` (discriminated unions, imported by both sides).

**Trigger moved to M1** so the first user-visible milestone already has a real detail panel — that's what makes the slice feel e2e. Connection form rewrite from template strings is *not* coupled to D15; it can stay as-is until it earns a rewrite.

### D16 — Build our own concurrency-capped HTTP foundation

~250 lines total across `src/paic/http.ts`, `src/paic/errors.ts`, `src/paic/pagination.ts`, `src/paic/realm-path.ts`, `src/paic/concurrency.ts`. Borrows ideas from frodo (axios-retry, 429 Retry-After, X-ForgeRock-TransactionId header, scope fallback) without taking frodo as a dependency. **One thing frodo doesn't do that we must:** cap parallelism (frodo `Promise.all`s without limits; we cap at ~10 to avoid stressing customer tenants on 1,000-call scans).

### D17 — Script body: VS Code `FileSystemProvider`, not in-webview renderer

For M2 (and beyond), scripts open in a real VS Code editor tab via a `paic-script://` URI scheme backed by `vscode.FileSystemProvider`. Inspector `ScriptCard` stays metadata-only (id, name, language, outcomes, referenced-by) and exposes an **Open body in editor** action. Read-only is enforced at M2 by `writeFile` throwing `FileSystemError.NoPermissions`.

**Why FileSystemProvider, not TextDocumentContentProvider:** both APIs surface as a real editor tab with full editor features (find, fold, multi-cursor, themes, minimap, language tokenizer). `FileSystemProvider` is the *read-write capable* surface — flipping to edit later is removing a single one-line refusal, not a re-architecture. Same URI scheme, same editor UX, strict superset of capability.

**Why not Monaco-in-webview:** ~1.5 MB bundle hit and a custom save/dirty/diff lifecycle that duplicates what the host editor already gives us for free. **Why not `react-syntax-highlighter`:** display-only — no find, no fold, no minimap, no future edit. Dead end.

**Bonus capabilities for free**, on top of D17's base shape:
- Diff scripts across tenants: `vscode.diff paic-script://tenantA/realm/x.js paic-script://tenantB/realm/x.js`
- Custom hover / code-lens / definition providers attach to any URI scheme — natural insertion point for "find all references" / "go to caller-journey" (M5+)
- Realm-as-folder browsing via `readDirectory` becomes a viable surface (M5+)

URI shape: `paic-script://<host>/<realm>/<scriptId>.<ext>` with `<ext>` ∈ {`js`, `groovy`} so the language-id auto-detects. Retires Q-16.

### D18 — Journey diagram: ReactFlow + dagre at M2

The per-journey node-flow diagram in the inspector renders via **ReactFlow** (graph-as-React-components) with **dagre** for auto-layout. Each AIC node kind has its own custom React node component; M3 expands the set.

**Considered and rejected: Mermaid.** Mermaid's declarative "describe-and-render" model is excellent for static diagrams but closes the door on every node-level interaction the product will plausibly want — hover-for-schema, right-click context menus, click-to-drill-into-referenced-script, custom node shapes per AIC kind, drag-to-rearrange, eventual inline-edit gestures (when D6 lifts). ReactFlow's "node = React component" model is the only one that doesn't paint us into a corner.

**Bundle cost:** ~+200 KB into `out/webview.js` (ReactFlow ~150 + dagre ~50). React + ReactDOM are already paid for. Comfortable.

**Reuse path:** the M6 realm-wide graph (D14 surface) and any M3 widening of node kinds both compose on top of this — same library, same custom-node pattern. Strengthens D15's framework lock.

### D19 — Conditional script-ref pattern: per-type predicate, not boolean type-membership

M1's resolver assumed *"if the node type is X, it has a script ref."* M3 introduces node types where the script ref's presence depends on a flag in the payload: `DeviceMatchNode` carries a script only when `payload.useScript === true`, `PingOneVerifyCompletionDecisionNode` only when `payload.useFilterScript === true`. We codify this as:

```ts
type ScriptRefPredicate = (payload: NodePayload) => boolean;
const SCRIPT_REF_PREDICATES: Record<string, ScriptRefPredicate> = {
  ScriptedDecisionNode: () => true,
  ClientScriptNode: () => true,
  ConfigProviderNode: () => true,
  SocialProviderHandlerNode: () => true,
  SocialProviderHandlerNodeV2: () => true,
  DeviceMatchNode: (p) => p.useScript === true,
  PingOneVerifyCompletionDecisionNode: (p) => p.useFilterScript === true,
};
```

Same table powers the tree's child-discovery, the diagram's click-to-drill, and (later) the RealmIndex's edge build. Lifted from frodo's `scriptedNodesConditions` shape (`ref/frodo-lib/src/ops/JourneyOps.ts:546`); we use ideas, not the library (per D2).

### D20 — Script-body parsing: loose-regex with "declared" semantics

Library-script references (`require('<name>')`) and ESV references live in script-body text, not in node payloads. M3's resolver extracts them via regex over the fetched JS/Groovy body. POC against sb3 (1,159 scripts) refined the original design:

```ts
const REQUIRE = /require\s*\(\s*['"]([^'"\\]+)['"]\s*\)/g;
const ESV     = /['"](esv\.[A-Za-z0-9_.-]+?)['"]/g;
```

**ESV regex rationale (POC-validated, see `poc/FINDINGS-esv.md`):**

- The original `&{esv.X}` syntax is an IDM config-string form, **never used inside JavaScript bodies** (0 hits across 1,159 scripts). Dropped.
- The original `systemEnv.X` syntax captured method names (`"getProperty"`) as false positives 435 times. Dropped.
- The dominant pattern is `systemEnv.getProperty("esv.x.y.z")` (383 scripts, 779 refs). The string literal IS the ESV name in dotted form.
- A broader class of scripts (442 total, 915 refs) declare ESV names as **string-literal config object fields** without calling `getProperty()` in the same body — the actual lookup happens in a downstream library that reads `nodeConfig.<field>`. The broad string-literal regex catches both call patterns and these config declarators.
- All 226 unique ESV refs in sb3 begin with `esv.` — safe to require the prefix.

**Semantics — "declared", not "used at runtime":** the parser reports every `esv.X` string literal that appears in source. This may include dead code or commented-out alternatives. We accept these phantom deps for two reasons: (1) we follow the npm / pip / maven convention of "all declared deps shown, dead-dep detection is a separate tool"; (2) **false negatives are more dangerous than false positives** for a dependency tool — missing a real dep could lead a user to delete an ESV that's actually live in prod.

**Comment stripping** runs before the regex to remove the largest false-positive class (`//` line + `/* */` block comments). Preserves URLs by not stripping `//` after `:`.

**Acorn-AST fallback** still available as Plan B if customers report meaningful false-positives the comment-stripped regex can't handle. Retires Q-13.

### D21 — Tree (lazy/fresh) and back-search (eager/cached) are separate data systems

Two completely decoupled data subsystems, each owning its own freshness:

| Layer | Mode | Cache scope | Refresh trigger |
|---|---|---|---|
| **Tree / inspector** | Lazy, always-fresh | Per-expansion, throwaway | Each tree expansion fetches fresh |
| **Back-search panel** (M5+) | Eager, persistent | Realm-wide index | Own TTL / explicit refresh button |

The two systems **never share cache state**. The back-search index never serves the tree. The tree's per-expansion data never populates the back-search index. Even when the back-search cache is warm, the tree still issues fresh HTTP calls.

Rationale:
- Tree = "show what's there *right now*" → freshness wins
- Back-search = "give me everything to query against" → completeness wins; staleness acceptable
- Coupling them would make refresh behavior unpredictable

Within the tree's lazy model, **per-expansion eager batching is allowed** (and used for ESV kind pre-labeling, see D22). That batching is scoped to one expansion event, fetched fresh, discarded on refresh — it does not leak into the back-search subsystem.

### D22 — ESV resolution: REST id translation, kind pre-labeling, card field set

Three locked aspects of ESV handling (validated against sb3 — see `poc/FINDINGS-esv.md`):

**1. Dotted ↔ hyphenated id translation.** Scripts reference ESVs in dotted form (`esv.kyid.portal.name`); the PAIC REST API requires hyphenated ids (`esv-kyid-portal-name`). The dotted form returns 400; only hyphenated returns 200. Translation lives inside `PaicClient.getEsv()` and the resolver-side list-then-filter; the dotted form remains the canonical display name everywhere else.

**2. Per-script-expansion kind pre-labeling.** When a `ScriptNode` expansion emits any `EsvNode`, the tree fires `listVariables(realm)` + `listSecrets(realm)` once per expansion to label each emitted node as `variable` / `secret` / `missing`. This is "small eager" inside the otherwise-lazy tree (per D21 — scoped to the expansion event, not shared with back-search). Tree icons differ by kind (variable vs secret vs `?` for missing). Cost: 2 list calls per script-expand; ESV lists are small (sb3 had 409 vars + 58 secrets — a few KB each paged). Missing entries stay in the tree with a "Not found in tenant" hint — we can't always distinguish a regex false-positive from a recently-deleted ESV.

**3. Card field set.** EsvCard renders the full REST-returned metadata for each kind. ESV variables are **not secrets**; decode `valueBase64` and display in the card.

| Field | Variable card | Secret card |
|---|---|---|
| Host / Realm / Name | ✓ | ✓ |
| Kind ("Variable" / "Secret") | ✓ | ✓ |
| Description | ✓ | ✓ |
| `expressionType` | ✓ (`string` / `int` / `bool` / `list` / `object`) | — |
| `encoding` | — | ✓ (`generic` / `pem` / `base64hmac` / `base64aes` / …) |
| Decoded value | ✓ (UTF-8 decode of `valueBase64`; `<code>` block + Copy button) | — (API never returns the value) |
| `activeVersion` / `loadedVersion` | — | ✓ |
| `useInPlaceholders` | — | ✓ |
| `loaded` | ✓ ("Yes (live)" / "No (staged)") | ✓ |
| `lastChangeDate` / `lastChangedBy` | ✓ | ✓ |

Value decoding (webview-side, no `Buffer`):

```ts
function decodeEsvValue(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
```

Display the decoded string as-is regardless of `expressionType` — users interpret per type. No pretty-print / coercion at M3; JSON pretty-print on `list`/`object` is a future polish if requested.

## Architecture (M2 target state)

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Extension Host (Node.js)                      │
│                                                                       │
│  src/extension.ts ──► activate(): commands + view registration        │
│                                                                       │
│  ┌────────────────┐  ┌──────────────────┐  ┌─────────────────────┐   │
│  │   views/       │  │   resolver/      │  │   tenants/          │   │
│  │   ━━━━━━━     │  │   ━━━━━━━━━━    │  │   ━━━━━━━━━━       │   │
│  │  PaicTreeProv   │←→│ walk.ts          │←→│ registry.ts         │   │
│  │  nodes/        │  │ realm-index.ts   │  │ (settings+secrets)  │   │
│  │   base, conn,  │  │ cache.ts         │  └─────────────────────┘   │
│  │   realm,       │  └────────┬─────────┘                            │
│  │   journey,     │           │ uses                                  │
│  │   script,      │           ▼                                       │
│  │   innerJ       │  ┌──────────────────┐  ┌─────────────────────┐   │
│  └────────────────┘  │   domain/        │  │   paic/              │   │
│         │            │   ━━━━━━━━━━    │  │   ━━━━━━━━━━       │   │
│         │ consumes   │ types only:      │←─│ http.ts             │   │
│         ▼            │  Connection,     │  │ auth.ts (JWT)       │   │
│  ┌────────────────┐  │  Realm, Journey, │  │ client.ts           │   │
│  │   webview/     │  │  Script,         │  │ realm-path.ts       │   │
│  │   panel.ts     │  │  InnerJourney    │  │ pagination.ts       │   │
│  │   ui/ (React)  │  └──────────────────┘  │ concurrency.ts      │   │
│  │   messages.ts  │           ▲             │ errors.ts           │   │
│  └────────────────┘           │             │ mappers.ts          │   │
│         │                     │             └─────────┬───────────┘   │
│         │ postMessage         │ raw→domain            │ HTTPS         │
│         ▼                     │                       │               │
└─────────┼─────────────────────┼───────────────────────┼───────────────┘
          │                     │                       │
          ▼                     │                       ▼
   Sandboxed iframe        (one-way edge)         PAIC tenant
   (React + ReactFlow)                            REST API
```

## Data model

```typescript
// User-owned (persisted)
interface Connection {
  host: string;          // identity
  saId: string;
  name?: string;         // display label
}
// saJwk lives in SecretStorage; never crosses into types directly.

// Resolved graph — produced by resolver, consumed by tree/webview/index
type NodeKind =
  | 'journey' | 'node' | 'script' | 'library-script'
  | 'inner-journey' | 'esv' | 'theme'
  | 'email-template' | 'saml-entity' | 'social-idp';

type EdgeKind =
  | 'contains' | 'calls-inner-tree' | 'invokes-script'
  | 'imports-library' | 'references-esv' | 'uses-theme';

interface GraphNode {
  id: string;            // `${kind}:${stableId}` — composite
  kind: NodeKind;
  label: string;
  raw?: unknown;         // original PAIC JSON, for detail pane
}

interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  via?: string;          // node uuid that connects them, for explainability
}

interface DependencyGraph {
  rootId: string;
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
}

// RealmIndex — produced by background scan, consumed by query panel
interface RealmIndex {
  host: string;
  realm: string;
  builtAt: number;                              // epoch ms
  journeys: Map<string, JourneySkeleton>;       // by journey _id
  edges: {
    journeyToScript: Array<{ journey: string; script: string }>;
    journeyToInner:  Array<{ journey: string; inner:  string }>;
  };
  reverse: {
    scriptToJourneys: Map<string, Set<string>>;
    innerToJourneys:  Map<string, Set<string>>;
  };
}
```

## Milestones

Each milestone ships a working, testable user flow. The foundation is laid in M1 such that M2–M7 add capability without redesigning earlier work. The order favors **broadening depth first** (M3 expands dep kinds before any analysis is built), so when the index lands in M4 the graph is already complete.

### M0 — Connection CRUD ✅

Add/edit/remove connections. Settings.json + SecretStorage. LogOutputChannel. Tail-able log file. Test Connection button (mints token via JWT-bearer). **Done.**

### M1 — Forward exploration with detail panel (current target)

**User-facing outcome:** *"I can pick a connection, browse to a realm, open a journey, see its scripts and inner-trees as children, and selecting any item shows basic information in a detail panel on the right."*

Foundation built in this milestone — minimum to ship the slice, shaped to absorb later growth:

**Transport + domain layers**
- `src/paic/auth.ts` ✓ (done)
- `src/paic/errors.ts` — `PaicError` flattening AxiosError fields
- `src/paic/realm-path.ts` — `getRealmPath(realm)` verbatim from frodo
- `src/paic/pagination.ts` — `listAllPaged(fetchPage)` helper
- `src/paic/concurrency.ts` — `mapConcurrent(items, N, fn)` helper
- `src/paic/http.ts` — axios instance per connection, retry, 429 Retry-After, error wrap
- `src/paic/mappers.ts` — raw → domain translation
- `src/paic/client.ts` — `PaicClient` with `listRealms`, `listJourneys`, `getJourney`, `getNode`, `getScript`
- `src/domain/types.ts` — `Connection`, `Realm`, `Journey`, `Script`, `InnerJourneyRef`
- `src/tenants/registry.ts` — extracts connection-listing logic from `extension.ts`

**Tree view (deeper levels + class hierarchy cutover)**
- `views/nodes/base.ts` — abstract `PaicNode` (D12 cutover happens here, not in a later milestone)
- `views/nodes/connection.ts`, `realm.ts`, `journey.ts`, `script.ts`, `inner-journey.ts`
- Lazy `getChildren()` per kind; loading/error states; Refresh command

**Detail panel (D15 trigger — webview framework lands here)**
- `src/webview/inspector/` — single React panel that lives in the editor area (`ViewColumn.Beside`)
- esbuild second entry → `out/webview.js`
- Typed message protocol `src/webview/messages.ts`
- Tree-selection event → `postMessage` with `(kind, id, raw)` → panel renders a basic info card
- Card content per kind:
  - **Connection:** host, saId, name, last-tested timestamp
  - **Realm:** name, journey count
  - **Journey:** id, description, enabled, identityResource, node count, list of scripts referenced, list of inner journeys referenced (each clickable → navigates tree selection)
  - **Script:** id, name, language, outcomes, inputs/outputs (no body content yet — that's M2)
  - **Inner-journey leaf:** same as Journey
- VSCode CSS variables, no component lib yet

**Tests**
- Unit tests for `paic/*` against captured POC fixtures
- Light component tests for the panel — render-with-mock-data smoke tests

**What M1 deliberately does NOT do**
- No script body rendering — only metadata in the panel (M2 adds the body).
- No per-journey node-flow diagram — only metadata (M2 adds it).
- No themes, ESVs, library scripts via `require()` (M3).
- No RealmIndex / background scan (M4).
- No query panel / reverse lookups / orphans (M5).
- No realm-wide graph webview (M6).
- No saved graphs, no diff (M7).
- Connection form stays a template-string webview (rewrite happens whenever it earns it; not coupled to D15 trigger anymore).

### M2 — Fill the detail panel: real content

**User-facing outcome:** *"When I click a script in the tree, its body opens in a real editor tab beside the inspector — full find, fold, themes, syntax highlighting, multi-cursor. When I click a journey, the inspector shows an interactive diagram of its node flow; clicking a node in the diagram navigates the tree to the underlying script."*

Two locked off-the-shelf bets, both with extensibility headroom (see D17, D18):

- **Script body via `FileSystemProvider`** (D17). Register the `paic-script://` scheme; clicking a script (or "Open body in editor" from the inspector / a right-click on a `ScriptNode`) opens the body in a real editor tab via `workspace.openTextDocument`. Read-only enforced at M2 — `writeFile` throws `NoPermissions`. The architecture is write-capable; the flip lives behind D6.
- **Per-journey diagram via ReactFlow + dagre** (D18). Custom node components per AIC kind (M3 widens the set). Click-a-node → posts a `navigate` message → existing cross-nav handler reveals the target tree row and re-renders the inspector. Hover-a-node → tooltip with inputs / outputs / outcomes.
- **Hover tooltips on tree items** — Markdown-formatted metadata via `TreeItem.tooltip = new vscode.MarkdownString(...)`. No webview.
- **Persist tree collapse state** to `globalState` keyed by node `uid` (UX win we lifted from the database-extension audit).
- **"Open in Diff Editor"** — once two `paic-script://` URIs exist for the same script (e.g., across two connections), `vscode.diff` gives us a tenant-vs-tenant diff editor for free (free side-effect of D17).

### M3 — Wider dependency kinds

**User-facing outcome:** *"My tree, diagram, and detail panel show every meaningful dependency: themes, email templates, social IdPs, library scripts (via `require()`), and ESVs (via `&{esv...}` / `systemEnv.X`). When I click a script in the tree, I can drill into its library-script and ESV references."*

Two distinct widenings — node-level (more payload fields → more journey edges) and script-level (parsing the fetched body → script edges).

**Node-level edges added** (per D19's predicate table where applicable)
- `ClientScriptNode` → script
- `ConfigProviderNode` → script
- `SocialProviderHandlerNode` / `SocialProviderHandlerNodeV2` → script *and* social-IdP list (`payload.filteredProviders: string[]`)
- `DeviceMatchNode` → script — **only if `payload.useScript === true`** (D19 conditional pattern)
- `PingOneVerifyCompletionDecisionNode` → script — **only if `payload.useFilterScript === true`** (D19)
- `PageNode` → child nodes (walk `payload.nodes[]` inline) + theme (parse `payload.stage` for `themeId`)
- `EmailSuspendNode` / `EmailTemplateNode` → email template (resolved against IDM managed-templates)
- `SelectIdPNode` → social-IdP list (`payload.filteredProviders`, no script)

**Script-level edges added** (per D20 — regex over fetched bodies)
- script → library-script via `require('<name>')`
- script → ESV via `&{esv.X}` or `systemEnv.X`
- library-script → library-script / ESV (recursive; reuses M1's cycle-guard pattern keyed on `(kind, id)`)

**Tree / inspector / diagram surface grows**
- `ScriptNode` stops being a leaf — gains `loadChildren()` that fetches the script body and emits `LibraryScriptNode` + `EsvNode` children.
- New node classes in `src/views/nodes/`: `library-script.ts`, `esv.ts`, `theme.ts`, `email-template.ts`, `social-idp.ts`.
- New inspector cards: `LibraryScriptCard` (with diagram via reused `JourneyDiagram` patterns? — TBD; library scripts don't have a tree-flow), `EsvCard`, `ThemeCard`, `EmailTemplateCard`, `SocialIdpCard`.
- Diagram replaces the `Other` fallback for `PageNode`, `EmailSuspendNode`, `EmailTemplateNode`, `SocialProviderHandlerNode*`, `SelectIdPNode`, `DeviceMatchNode`, `ConfigProviderNode`, `ClientScriptNode`, `PingOneVerifyCompletionDecisionNode` with proper per-kind components.

**Fetch growth**
- Each journey-expand now also fetches every script body for the journey's referenced scripts. Bounded by `mapConcurrent` (cap 10). Library-script + ESV resolution happens on `ScriptNode` expansion, not on journey expansion — keeps lazy contract.
- New PAIC client methods: `getEmailTemplate`, `getSocialIdp`, `getTheme`, `getEsv` (or `listEsvs` + lookup). Library scripts are scripts where `script.type === "library"` — reuse `getScript`.

**Deferred past M3** (call out so the gap is visible)
- `product-Saml2Node` (SAML entities + circles of trust) — narrower customer segment; needs two-fetch resolution (provider stubs + CoT list). Worth its own slice when SAML flows enter scope.
- `designer-*` custom marketplace nodes — minority of customers; defer until requested.

**Done here on purpose**: ship breadth before the index, so when M4 (RealmIndex) lands the indexable graph already covers every edge kind.

### M4 — RealmIndex background scan

**User-facing outcome:** *"When I expand a realm, the tree appears instantly and a background indexer prepares the realm for analysis. I see indexing progress somewhere subtle."*

- `src/resolver/realm-index.ts` — `buildIndex(client, realm) → RealmIndex` (pure logic).
- Wire to realm-expand event in the tree.
- Indexes all edge kinds shipped through M3 (journey→script, journey→inner, journey→theme, script→library-script, script→ESV).
- Status indicator (status-bar or sidebar title — open question Q-8).
- Cancellation when realm collapsed mid-scan (open question Q-9).

Still no UI for queries — that's M5.

### M5 — Query panel (reverse lookups + orphans)

**User-facing outcome:** *"I right-click a realm or click 'Open Query Panel', pick 'Reverse Lookup', enter a script ID, and see every journey that uses it. Or I pick 'Orphans' and see scripts referenced by nothing."*

- Query panel = second React webview (D15 already paid for in M1, so this is purely additive).
- Tabs: Reverse Lookup / Orphans / Impact (impact full-power lands in M7).
- Re-uses the typed message protocol from M1.
- Queries span all dep kinds from M3 (script, library-script, ESV, theme, inner-journey).

### M6 — Realm-wide graph webview

**User-facing outcome:** *"From a realm or query result, I can open a graph view showing the realm's dependency graph as nodes-and-edges with ReactFlow."*

- `src/webview/graph/` — third React entry (M1 inspector + M5 query + M6 graph).
- Re-uses ReactFlow already brought in at M2.
- Hierarchical + force-directed layouts toggle.
- Kind-colored nodes, typed edges, filter chips per `NodeKind`.

### M7 — Impact analysis + saved graphs + diff

**User-facing outcome:** *"I can ask 'if I change this library script, what breaks?' and get a chain of affected journeys. I can save a graph snapshot to compare against another tenant or another time."*

- Impact = reverse-reachability over the union of edge kinds.
- Saved graphs: explicit user action writes to `globalStorageUri/cache/<host>/graphs/<timestamp>.json` (the only place we ever write derived data — and only by explicit user choice).
- Diff: side-by-side comparison of two saved graphs.

## Open questions

**Foundation**
- Q-1 — Mapper location: `src/paic/mappers.ts` vs `src/domain/from-paic.ts`?
- Q-2 — Folder name: `domain/` vs `models/` vs `types/`?
- Q-3 — Concurrency primitive: `p-limit` (~3 KB) vs hand-rolled `mapConcurrent` (~25 lines)?
- Q-4 — `X-ForgeRock-TransactionId` value: per session, per request, or per batch?
- Q-5 — 429 strategy: rely on `axios-retry` built-in, or replicate frodo's custom interceptor?
- Q-6 — Concurrency cap value: 10 (POC-tested) vs 20 (~2× faster, untested)?

**Index / queries**
- Q-7 — Query panel surface: webview panel vs sidebar view vs activity-bar entry?
- Q-8 — Status indicator location while indexing: sidebar title, status bar, both?
- Q-9 — Cancellation policy when user collapses a realm mid-scan?

**Frontend**
- Q-10 — Connection form rewrite to React: still a template string after M1 — when does it earn the rewrite?
- Q-11 — React state mgmt: plain React vs Zustand vs Redux Toolkit?
- Q-12 — Hot reload during webview dev: Vite HMR vs `npm run watch` + reload?
- ~~Q-16~~ — Retired by D17 (FileSystemProvider).

**Resolver**
- ~~Q-13~~ — Retired by D20 (regex first, AST upgrade if needed).
- Q-14 — `_action=nextdescendents` bulk-fetch shortcut: viable? (still to POC)
- Q-15 — Import connections from sibling `paicLogSearch.environments`?

## Non-goals

- No write operations to PAIC.
- No alternative auth flows (admin user + 2FA, SSO, basic auth). Service-account JWT-bearer only.
- No support for PingOne, PingFederate, or non-PAIC ForgeRock deployments in v1.
- No telemetry, no analytics, no remote sync.
- No "live diff" between editor changes and tenant state.
- No on-disk cache of derived data (per D8). The lone exception is the *explicit user action* "save graph" in M7.
- No database. Ever. None of our access patterns are DB-shaped (we do graph BFS over small in-memory structures, not SELECT-WHERE-JOIN). Bringing in SQLite would add cross-platform binary headaches and break Settings Sync, with zero query benefit.
