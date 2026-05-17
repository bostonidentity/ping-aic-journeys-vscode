---
name: test
description: Run test suites. Use when the user wants to run tests, check if tests pass, or says "test", "run tests", "does it work", or "vitest".
---

Run Vitest tests and show failures clearly with file and line numbers.

## Determine scope

- No arguments: run fast tests only (`npm run test:fast`)
- `--all` or `all`: run full suite (`npm test`)
- Any other arguments: pass through to vitest (`npx vitest run $ARGUMENTS`)

## Never hit a live PAIC tenant

Integration tests that require a real tenant are gated behind `PINGPAIC_LIVE=1`. Do not set this env var in default runs. Only set it when the user explicitly asks for a live integration test.

## Live-tenant tests skip gracefully

Some integration tests load credentials from `~/.pctl/connections.json` or captured fixtures from `poc/` (both per-machine, not committed). The tests use `fs.existsSync()` to skip gracefully when the data is missing — a skip is NOT a failure. When reporting results, distinguish skips from actual passes/fails so the user knows what was covered.
