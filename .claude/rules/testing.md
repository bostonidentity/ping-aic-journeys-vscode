# Testing Rules

## File layout

- PAIC client + resolver unit tests colocated:
  `src/paic/auth.ts` → `src/paic/auth.test.ts`
  `src/resolver/walk.ts` → `src/resolver/walk.test.ts`
- Cross-cutting tests under `tests/` mirroring source:
  `src/util/logger.ts` → `tests/util/logger.test.ts`
- Integration tests: `.integration.test.ts` under `tests/integration/`
- VS Code API integration tests (if/when added): `tests/vscode-integration/`, run via `@vscode/test-electron`

## Fixtures

- Captured PAIC responses live in `tests/fixtures/` — **scrubbed** of real tenant hostnames, real journey/script/realm names, and any UUIDs that could correlate to a customer.
- Replace real values with `openam-tenant.example.forgeblocks.com`, `alpha`, `Login`/`Registration`, and synthetic UUIDs (`00000000-0000-0000-0000-00000000000N`).
- If no fixture exists, capture one against a live tenant into `poc/` (gitignored), scrub, then promote to `tests/fixtures/`.

## Live-tenant tests

- Live PAIC calls gated behind `PINGPAIC_LIVE=1` env var. Default `npm test` and `npm run test:fast` never hit a live tenant.
- Credentials for live tests come from `~/.pctl/connections.json` (a sibling CLI's profile store) or from the user's VS Code-stored connection. Never check credential files into this repo.
- Live tests live in `tests/integration/live.integration.test.ts` and skip themselves with `describe.skipIf(!process.env.PINGPAIC_LIVE)`.

## Practices

- Mock `axios` and `vscode` at the module boundary using `vi.mock()`.
- VS Code APIs (`vscode.window`, `vscode.workspace`, `vscode.SecretStorage`) — use a tiny in-test fake (see `tests/util/vscode-mock.ts` once created) rather than `vi.mock('vscode')` per-test. Reusable, less ceremony.
- Keep tests deterministic — no flaky timeouts, no real clocks. Use `vi.useFakeTimers()` for retry/backoff tests.
- PAIC client functions are testable as plain async functions — no need to instantiate a fake Extension Host for unit coverage.
- Use temp directories for any FS interaction (`tmp-promise` or `fs.mkdtempSync`).
- Test behavior, not implementation. Walk-graph tests assert on the resulting nodes/edges, not on which HTTP calls happened in what order.
- Descriptive test names: `"walks a journey with one inner journey and one library script"`, not `"test1"`.

## What to test (priority order)

1. `src/paic/auth.ts` — token mint, cache hit/miss, scope fallback, 401 invalidate.
2. `src/paic/realm-path.ts` — covers the four cases (empty, leading slash, single, sub-realm).
3. `src/paic/errors.ts` — `AxiosError` flattening preserves status, code, description, body.
4. `src/paic/http.ts` — header injection, retry on 502/503, no retry on 4xx.
5. `src/resolver/walk.ts` — fixtures with inner tree, library script, ScriptedDecisionNode, PageNode, cycle.
6. `src/tenants/registry.ts` — settings + SecretStorage round-trip, rename moves secret.
7. Commands — happy path + cancel path.
