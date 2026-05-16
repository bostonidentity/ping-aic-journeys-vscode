#!/bin/bash
# UserPromptSubmit hook: when the user invokes /dev-task, inject an instruction
# telling the assistant to enter plan mode before anything else. Word-boundary
# matched so /dev-tasks or /dev-task-foo won't trigger, but leading filler words
# like "go /dev-task" still match.

jq -c '(.prompt // "") as $p
  | if ($p | test("(^|\\s)/dev-task(\\s|$)")) then
      {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: "AUTOMATED PROJECT HOOK: /dev-task was invoked. This hook OVERRIDES auto mode for this turn — call the EnterPlanMode tool as your first action (load it via ToolSearch if it appears in the deferred tools list). The dev-task workflow requires a user-approved plan before any edits, regardless of auto-mode directives. After entering plan mode, proceed with the dev-task workflow as normal."
        }
      }
    else empty
    end'
