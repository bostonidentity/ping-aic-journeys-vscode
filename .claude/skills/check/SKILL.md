---
name: check
description: Run lint + type-check + tests in sequence. Use when the user wants to validate code, run all checks, verify everything passes, or says "check", "run checks", "does it pass", or "validate".
---

Run all checks and report results. Stop on first failure.

## Determine scope

- If $ARGUMENTS is "fast" or "all", it controls test depth (passed to `/test`).
- If no arguments, default to fast tests.

## Steps

1. Run `/lint`
2. `npx tsc --noEmit`
3. Run `/test` — pass $ARGUMENTS through (e.g. `/check fast` → `/test fast`, `/check all` → `/test all`)
