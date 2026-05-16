---
name: walkthrough
description: Interactive discovery mode while the user exercises the running app and reports findings one at a time. Trigger whenever the user says "/walkthrough", or reports a finding mid-session — "I found a bug in X", "X looks wrong", "I want to change X", "the Y view should...", "this is off", or similar. Covers bugs AND design changes discovered while walking through dev or prod builds. Always use this skill for post-ship discovery work even if the user doesn't explicitly ask — if they're describing observed behavior in the running app or proposing a UX shift, this is the right entry point, NOT dev-task (which is for pre-planned phase work).
---

# Walkthrough mode

The user is running the app (dev or prod) and is about to surface things they notice. Your job is to handle **one finding end-to-end before moving on** — log it, resolve any conflicts with the design docs, implement, verify, hand it back for review. Never let a second finding pile up behind an unfinished first one.

This skill exists because findings get forgotten when batched. The user explicitly wants the round-trip to feel short: *describe → see it fixed → confirm → describe the next one*.

## Invocation

- **`/walkthrough`** (no args) — enter walkthrough mode. Run the session-start orient step, then wait for the user to describe their first finding.
- **`/walkthrough <finding text>`** — force-triggered with the finding already provided. Still run session-start orient (read backlog, skim progress/design-plan), but then jump straight to "Handle one finding" with the argument text as the user's description. Don't ask them to restate it.
- **Implicit triggers** — natural phrases like "I found a bug in X", "X looks wrong", "I want to change Y", etc. mid-session. Treat these the same as `/walkthrough <their words>`.

## Non-goals — do not do these

- **Don't start the dev server.** The user is already running it.
- **Don't replace dev-task.** dev-task is for phase-planned work from `docs/progress.md`. walkthrough is for post-ship discovery. If a finding turns out to be phase-sized, promote it to a new phase row in `progress.md` and suggest running dev-task next session — don't try to do all the work under walkthrough.
- **Don't batch findings.** Exactly one open-in-progress finding at a time.

## At session start (first time entering walkthrough this session)

Orient yourself so classification is informed:

1. Read `docs/backlog.md`. If it doesn't exist, create it with this header:
   ```markdown
   # Backlog

   Findings discovered via the walkthrough skill. One row per finding, grouped by type (`B-NN` bugs · `D-NN` design changes). Status cycles: `open` → `in-progress` → `done` (or `rejected` / `deferred`). Phase-sized work doesn't live here — it gets promoted to `docs/progress.md` instead.
   ```
2. Skim `docs/progress.md` so you know what's already shipped and what's phase-planned — avoids misclassifying something as "new" when it's already on the roadmap.
3. Skim `docs/design-plan.md`'s "Locked decisions" section (the D1–DN entries). These are the project's "load-bearing beliefs"; design-change findings may need to override one.

You only need to do this once per session. On subsequent findings, skip to "Handle one finding."

## Handle one finding

### 1. Classify it

Given what the user reported, pick one category. Default to the smaller classification; promote only when the scope clearly exceeds a single commit.

- **`B-NN` bug** — observed behavior is broken or wrong against current design. Usually one-commit.
- **`D-NN` design change** — user wants a direction shift. The current behavior might be "working as specified" but the user wants different specs. Check for contradictions with `design-plan.md` D-decisions before acting.
- **Phase-sized** — touches many files/components, needs multi-task sequencing, or is a new capability. Don't jam it into the backlog — promote to a new phase in `docs/progress.md` and stop. Tell the user to run `/dev-task` next session to start it. This prevents half-baked multi-session work leaking out of walkthrough's one-at-a-time model.

Give the new finding the next unused ID by scanning the last `B-NN` and `D-NN` in `docs/backlog.md`. IDs are independent per type.

### 2. Append to backlog.md immediately

Append this block above any previously-logged `rejected`/`deferred` rows, in simple numeric order within its type. Status starts `open`:

```markdown
## B-NN — <short title>          <!-- or D-NN -->
**Where:** page / module / view
**Observed:** what the user saw — one or two concrete sentences
**Proposed:** fix or redesign direction — one or two sentences
**Status:** open
```

Then flip the status to `in-progress` as you proceed through the next steps. Having `open` briefly in the file even for <1 minute gives us a continuous record even if the session drops.

### 3. Locked-decision guardrail (design changes only)

If this is a `D-NN` and the proposed change contradicts a D-decision in `design-plan.md`, STOP — do not plan code changes yet. D-decisions are load-bearing and can't be overridden silently.

Draft a new D (use the next unused number, e.g. D11) in `design-plan.md` after the last existing D. The opening sentence must include the exact phrase **"supersedes DN's claim that ..."**. Show the draft D to the user verbatim. Wait for their approval before writing any code. If they don't like it, adjust the draft; if they withdraw the change, mark the backlog row `rejected` with a reason.

For pure bug fixes (`B-NN`), this guardrail doesn't apply — a bug by definition is an unintended deviation from existing design, so fixing it is not a new decision.

### 4. Enter plan mode for THIS finding only

Use the standard `EnterPlanMode` → draft a small plan → `ExitPlanMode` loop. Scope is one finding. Don't drift into adjacent cleanup unless the user asks. The plan can be a few lines if the fix is tiny — don't inflate a one-line fix into a multi-section design doc.

When the plan is approved, implement exactly what was approved.

### 5. Verify

Run `/check fast` (lint + typecheck + test:fast) after the change. Recovery strategy matches `dev-task`: fix one issue and retry, up to 3 times total. If still failing after 3 retries, stop, summarize the failures, and ask the user how to proceed. Never loop silently.

### 6. Hand back for review

Present what changed in a few lines — files touched, key behavior change, any new tests. Then wait. Don't proactively advance to the next finding; the user must explicitly confirm.

The user might ask you to tweak the fix ("actually move the button to the left, not the right") — treat that as a continuation of the same finding, not a new one. Update the code, re-verify, present again. The finding stays `in-progress` through this loop.

### 7. Close out

When the user confirms the fix looks good:

1. Flip the backlog row's status from `in-progress` to `done`.
2. Add the user-visible line to `CHANGELOG.md`'s `## [Unreleased]` section. Keep it short — one bullet, active voice, what a user would notice.
3. Ask if they want to commit now (`/commit`), or keep walking and commit a batch later. Respect their answer.
4. Append the commit SHA to the backlog row once committed, so the row self-describes: `**Status:** done — <sha>`.

Only after close-out: ask "next finding?" or wait for them to bring one up.

## If the user surfaces a second finding mid-implementation

Stop typing. Ask once, briefly: *"Pause current work on [B-NN / D-NN], or finish this one first?"* The right answer is usually "finish" unless the first finding just turned out to be wrong or blocked. Don't silently juggle two in-progress rows.

If they want to pause:
- Leave the current `B-NN` at `in-progress` in backlog.md, but add `**Blocked by:** <next ID>` to it.
- Start the new finding at step 1. When the new one finishes, return to the blocked one.

## If the user says "skip" / "defer" / "reject"

- **Skip / defer** — backlog row stays `open`, add a `**Deferred:** <reason>` line. Move to the next finding.
- **Reject** — row becomes `rejected` with a `**Rejected:** <reason>` line. This is the right outcome when the user realizes on reflection that the finding was wrong.

Either way, the row stays in `backlog.md` as a historical record — we don't delete findings, even rejected ones.

## Why this shape

- **One at a time** is the core constraint. The user said explicitly: if findings pile up, they forget context. Round-trip has to feel short — describe, see fix, confirm, describe next.
- **Backlog as permanent record** means even sessions that crash mid-finding have a durable trace. Status columns show exactly where work was left.
- **Locked-decision guardrail** enforces the project's `dev-task` rule ("never contradict a locked decision without raising it") into this mode too. Design changes are welcome but must update the decision log before the code.
- **Phase-sized → progress.md** prevents walkthrough from becoming a catch-all for big rewrites. If it's too big for one commit, it's too big for walkthrough; it deserves real phase planning.
- **CHANGELOG on close** keeps the user-visible release notes flowing naturally from real work, rather than something assembled right before a release.

## Integration with other skills

- **`/commit`** — the natural endpoint for a finished finding. Respects its own pre-flight checks; don't bypass them.
- **`/check`** — used during verification. `/check fast` or `/check all`.
- **`/dev-task`** — for phase-sized promotions. walkthrough never tries to do dev-task's job.
- **`/update-progress`** — only relevant when a finding gets promoted to phase-sized and you've added a row to `progress.md`.
