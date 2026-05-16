---
name: update-progress
description: Update the progress doc after finishing work. Use when the user finishes a task, wants to sync progress, or says "update progress", "mark it done", or "what's the status now".
---

Update `docs/progress.md` to reflect the current state of the project.

## Rules

- `docs/progress.md` tracks **only**: phase checklists, what's working, what's broken, active blockers.
- Design decisions, architectural choices, and locked "why" decisions all go in `docs/design-plan.md` (the "Locked Decisions" section is append-only — never edit past entries without user approval).
- Keep "What's working today" as a concise bullet list.
- Keep "Active blockers" empty or to one line.

## Steps

1. Read `docs/progress.md` and `docs/design-plan.md` to understand current state.
2. Scan the codebase to determine what actually exists and works.
3. Compare what exists against the phase checklists. For each checkbox, determine:
   - **Done (`[x]`)**: code exists, lints, type-checks, tests pass, functionality is wired up
   - **Partial**: some files exist or placeholder code still in place — leave unchecked and note in `What's broken` if it's a known gap
   - **Not started**: leave unchecked
4. Update `docs/progress.md` with:
   - Accurate checkbox status across all phases
   - "What's working today" — concise bullet list of working functionality
   - "What's broken today" — anything in-progress with a known issue
   - "Active blockers" — anything truly stuck (rare)

If $ARGUMENTS is provided, treat it as additional context about what was just completed.

Only update `docs/progress.md`. Do NOT change `design-plan.md` or any code files.
