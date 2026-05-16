#!/usr/bin/env bash
# Tail the latest "AIC Journeys" OutputChannel log file.
# Usage: ./dev-tail.sh
set -e
LATEST=$(find "$HOME/Library/Application Support/Code/logs" \
  -name '*AIC Journeys*.log' -print0 2>/dev/null \
  | xargs -0 ls -t 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
  echo "No log file yet. Launch the extension (Cmd+Shift+P -> Debug: Start Debugging) and try a command first."
  exit 1
fi
echo "Tailing: $LATEST"
echo "---"
tail -F "$LATEST"
