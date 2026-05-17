---
name: dev-task
description: Plan and implement the next development task. Use when the user wants to build a feature, work on a task, implement something from the design plan, or says things like "let's work on the resolver", "build the PAIC client", "what's next", or "pick up the next task".
---

Pick up the next task from the development plan and implement it. The goal is to produce working, tested code — but the plan matters more than the code. A bad plan wastes tokens and time; a good plan makes implementation mechanical.

## Phase 1: Understand current state

1. Read `docs/progress.md` to see what's done, what's partial, what's next.
2. Read `docs/design-plan.md` for design context AND the "Locked decisions" section (the "why" behind each choice). **Never contradict a locked decision without explicitly raising it with the user first.**
3. Read `docs/lessons.md` for past corrections — avoid repeating known mistakes.
4. Read `.claude/rules/conventions.md` for coding rules (logging levels, import boundaries, error handling, naming). Follow these when writing code.
5. Identify the next task to work on — follow the phase order; earlier phases must be done before later ones.
6. If $ARGUMENTS is provided, treat it as the specific task to work on (e.g. "auth.ts" or "resolver walk") instead of auto-detecting.

## Phase 2: Explore and plan (the most important phase)

This phase is cheap in tokens and prevents expensive rework. Take your time here.

7. Read all source files relevant to the next task:
   - Files the task will create or modify
   - Files the task depends on (imports, types, existing patterns)
   - Existing test files to understand testing conventions
   - Authoritative design notes: `docs/design-plan.md` (locked decisions + milestones), `docs/sidebar-tree.md` (tree shape), `docs/logging-spec.md` (log contract). For HTTP/auth patterns also peek at `ref/frodo-lib/src/api/BaseApi.ts` and `ref/frodo-lib/src/ops/AuthenticateOps.ts` (gitignored reference clone) for ideas — never import.
8. Determine which layer this task targets:
   - **`src/paic/`** — raw PAIC REST client. Pure TypeScript, no `vscode` imports. Uses `axios` + `jose`.
   - **`src/resolver/`** — pure dependency graph builder. No `vscode` imports.
   - **`src/tenants/`** — Connection registry wrapping `getConfiguration` + `SecretStorage`. May import `vscode`.
   - **`src/views/`** — `TreeDataProvider` implementations. May import `vscode`.
   - **`src/commands/`** — command handlers. May import `vscode`.
   - **`src/webview/`** — React webview UI bundle (separate esbuild entry). React + ReactFlow.
   - **`src/extension.ts`** — wiring layer, imports from all of the above.
9. For PAIC work: **always test against captured fixtures in `tests/fixtures/`**, never hit a live tenant during development. If no fixture exists, ask the user to capture one against a live tenant into `poc/` (gitignored), then scrub before promoting to `tests/fixtures/`.
10. Consult library docs via type definitions in `node_modules/` — `axios`, `jose`, `vscode`.

### Plan Round 1 — Draft

11. Write a detailed implementation plan in a chat message (do not start editing code yet):
    - Files to create/modify (with exact paths)
    - Types and interfaces to define
    - Functions to implement (with signatures and key logic)
    - Tests to write (with test names and what they verify)
    - Changes to existing files (imports, wiring, command registration)
    - Any risks or open questions

12. Present the plan to the user and **wait for feedback**. Explicitly ask: "Does this plan look right? Any changes before I proceed?"

### Plan Round 2 — Revise

13. Incorporate the user's feedback into the plan. If they had corrections, update the plan and present the revised version.
14. If the user approves (or says something like "go", "looks good", "do it"), proceed to Phase 3.
15. If the user has more feedback, revise again until they approve.

## Phase 3: Implement

16. Exit plan mode and create/modify files according to the approved plan.
17. Run `/lint fix` to auto-fix formatting.

## Phase 4: Verify with recovery

18. Run `/check all`. For TS-only tasks (the default), this is lint + typecheck + tests.

If checks fail, follow this recovery strategy:

- **Lint failure** → run `/lint fix` and retry `/check all`
- **Type error** → read the error, fix the code, retry `/check all`
- **Test failure** → analyze the failure, fix the code or test, retry `/check all`

Retry up to **3 times total**. If still failing after 3 attempts:
- Stop and summarize what's failing and why
- Show the error output
- Ask the user how to proceed (fix manually, change approach, or skip)

Do not silently loop. Each retry should fix a different issue, not retry the same broken thing.

## Phase 5: Update progress

19. Run `/update-progress` to update docs with new task status.

## Phase 6: Record lessons (if applicable)

20. If the user corrected any assumptions during planning or implementation, add an entry to `docs/lessons.md` so the same mistake isn't repeated in future tasks.
