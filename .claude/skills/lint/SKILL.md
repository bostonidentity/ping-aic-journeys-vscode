---
name: lint
description: Run linters and show results. Use when the user wants to lint, fix formatting, or says "lint", "format", "fix style", or "biome check".
---

Run Biome on the TypeScript codebase and show issues clearly.

## Determine scope

- If $ARGUMENTS is "fix", auto-fix.
- Otherwise check only (read-only report).

## Commands

- Lint (check only): `npm run lint`
- Auto-fix: `npm run lint:fix`

Report results. If everything passes, say so briefly.
