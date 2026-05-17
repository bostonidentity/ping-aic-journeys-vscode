#!/usr/bin/env bash
# Tail the latest "PAIC Journeys" OutputChannel log file.
# Usage: ./dev-tail.sh
set -e

# Linux: ~/.config/Code/logs; macOS: ~/Library/Application Support/Code/logs
LOG_ROOTS=(
  "$HOME/.config/Code/logs"
  "$HOME/Library/Application Support/Code/logs"
)

LATEST=""
for root in "${LOG_ROOTS[@]}"; do
  [ -d "$root" ] || continue
  # Collect matches first; only pipe through ls when we actually have hits.
  # (GNU xargs runs ls with no args on empty stdin, which would list CWD.)
  matches=$(find "$root" -name '*PAIC Journeys*.log' 2>/dev/null)
  [ -n "$matches" ] || continue
  candidate=$(printf '%s\n' "$matches" | tr '\n' '\0' | xargs -0 ls -t 2>/dev/null | head -1)
  if [ -n "$candidate" ]; then
    LATEST="$candidate"
    break
  fi
done

if [ -z "$LATEST" ]; then
  echo "No log file yet. Launch the extension (Cmd+Shift+P -> Debug: Start Debugging) and try a command first."
  exit 1
fi
echo "Tailing: $LATEST"
echo "---"
tail -F "$LATEST"
