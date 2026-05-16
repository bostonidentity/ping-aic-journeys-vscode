---
name: commit
description: Git commit with conventional format. Use when the user wants to commit, save progress, push changes, or says "commit", "save this", "push it", or "ship it".
---

Follow commit rules in `.claude/rules/conventions.md` "Commits" section.

## Step 1: Verify → `/check fast`

Run `/check fast`. Abort if anything fails.

## Step 2: Stage and commit

1. Stage changed files with `git add` (specific files, not `-A`).
2. Commit with message: `$ARGUMENTS`
3. Push to remote with `git push`

Message must use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.

Append to the commit body:

```
Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

## Never commit

- `.env` files (any variant except `.env.example`)
- `sandbox/` (anything)
- Captured HARs (`*.har`) and exported AIC bundles (`*Export*.json`) from `poc-journey-export/paic-ui/`
- Anything matched by the pre-tool secrets hook

The `.gitignore` already excludes `node_modules/` and `out/`. Double-check `git status` before staging.
