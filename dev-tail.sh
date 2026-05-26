#!/usr/bin/env bash
# Tail the structured NDJSON log file produced by the PAIC Journeys extension.
#
# Usage:
#   ./dev-tail.sh             # tail the NDJSON file
#   ./dev-tail.sh --pretty    # pipe through `jq` for readable output (jq required)
#   ./dev-tail.sh --channel   # fallback: tail the VS Code Output-channel session log
#                             # (only useful if paicJourneys.logging.fileEnabled=false)
set -e

MODE="ndjson"
case "$1" in
  --pretty) MODE="pretty" ;;
  --channel) MODE="channel" ;;
  "" ) ;;
  *)
    echo "Usage: $0 [--pretty | --channel]" >&2
    exit 2
    ;;
esac

# ─── NDJSON sink (default) ───────────────────────────────────────────────
# Linux:  ~/.config/Code/User/globalStorage/<publisher>.<ext>/logs/...
# macOS:  ~/Library/Application Support/Code/User/globalStorage/<publisher>.<ext>/logs/...
NDJSON_PATHS=(
  "$HOME/.config/Code/User/globalStorage/bostonidentity.ping-aic-journeys/logs/paic-journeys.ndjson"
  "$HOME/Library/Application Support/Code/User/globalStorage/bostonidentity.ping-aic-journeys/logs/paic-journeys.ndjson"
)

if [ "$MODE" = "ndjson" ] || [ "$MODE" = "pretty" ]; then
  LATEST=""
  for p in "${NDJSON_PATHS[@]}"; do
    [ -f "$p" ] || continue
    LATEST="$p"
    break
  done
  if [ -z "$LATEST" ]; then
    echo "No NDJSON log file yet. Launch the extension and trigger a command first." >&2
    echo "(Looked at: ${NDJSON_PATHS[*]})" >&2
    echo "If paicJourneys.logging.fileEnabled=false, use ./dev-tail.sh --channel" >&2
    exit 1
  fi
  echo "Tailing: $LATEST"
  echo "---"
  if [ "$MODE" = "pretty" ]; then
    if ! command -v jq >/dev/null 2>&1; then
      echo "--pretty requires jq; install it or use the default mode" >&2
      exit 1
    fi
    tail -F "$LATEST" | jq -r '"\(.time) [\(.level | tostring)] \(.component // "-") \(.event // "-") \(.msg)"'
  else
    tail -F "$LATEST"
  fi
  exit 0
fi

# ─── Channel-log fallback ────────────────────────────────────────────────
LOG_ROOTS=(
  "$HOME/.config/Code/logs"
  "$HOME/Library/Application Support/Code/logs"
)

LATEST=""
for root in "${LOG_ROOTS[@]}"; do
  [ -d "$root" ] || continue
  matches=$(find "$root" -name '*PAIC Journeys*.log' 2>/dev/null)
  [ -n "$matches" ] || continue
  candidate=$(printf '%s\n' "$matches" | tr '\n' '\0' | xargs -0 ls -t 2>/dev/null | head -1)
  if [ -n "$candidate" ]; then
    LATEST="$candidate"
    break
  fi
done

if [ -z "$LATEST" ]; then
  echo "No channel log file yet. Launch the extension and trigger a command first." >&2
  exit 1
fi
echo "Tailing: $LATEST"
echo "---"
tail -F "$LATEST"
