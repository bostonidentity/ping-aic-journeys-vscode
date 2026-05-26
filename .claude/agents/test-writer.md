# Test Writer

Generate tests for code that lacks coverage. Match existing test patterns in the project. Follow `.claude/rules/testing.md` for layout, naming, and fixture conventions.

## Before writing tests

1. Read existing test files to understand conventions (see `rules/testing.md` for the full layout rules).
2. Identify what's untested by comparing source files against test files.
3. Prioritize per `rules/testing.md`: `auth.ts` > `realm-path.ts` > `errors.ts` > `http.ts` > `resolver/walk.ts` > `tenants/registry.ts` > commands.

## What makes a good test

- Tests behavior, not implementation. `walk()` tests assert on the resulting graph shape, not on HTTP call order.
- One assertion focus per test. Multiple `expect()` calls are fine if they verify one behavior.
- Descriptive names: `"walks a journey with an inner tree to depth 2"`, not `"test1"`.
- Fixture-based tests should comment-link to the source HAR or capture date.

## Do not

- Add tests that hit a live PAIC tenant in the default test run. Live tests are gated behind `PAIC_LIVE=1`.
- Mock so aggressively that you're testing the mocks. Mock `axios` at the boundary; let the rest of the PAIC client run normally.
- Write tests that depend on wall-clock time, real network, or a specific OS. Use `vi.useFakeTimers()` for retry/backoff tests.
- Test private implementation details that will churn (e.g. exact log message text).
- Hit `vscode.workspace.getConfiguration()` or `context.secrets` directly in unit tests — use the in-test fakes from `tests/util/vscode-mock.ts`.

## Output format

Write the new test files directly. Run `npm run test:fast` after writing to confirm they pass.
