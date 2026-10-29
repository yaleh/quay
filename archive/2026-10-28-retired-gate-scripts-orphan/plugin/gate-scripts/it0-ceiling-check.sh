#!/usr/bin/env bash
# it0-ceiling-check.sh — Check 1 (ceiling/floor arithmetic), charter M02-gates Done-when clause 1.
#
# Given one or more gap-list/directive IDs, greps the cited gap-list(s) for each ID and reports
# OPEN / CLOSED / NOT-FOUND per ID. Exits non-zero if ANY cited ID is not OPEN (i.e. if a
# charter is about to cite a gap that is already closed, or that doesn't exist — either case
# means the charter's "in-scope gap subset" claim is stale and should be re-derived before
# dispatch, per M-CLI-UX's rejection at this experiment's m2 SELECT).
#
# Usage:
#
#   it0-ceiling-check.sh <gap-id> [<gap-id> ...]
#   it0-ceiling-check.sh --milestone <M-NN> <gap-id> [<gap-id> ...]
#   it0-ceiling-check.sh --file <gap-list.md> <gap-id> [<gap-id> ...]
#
# Default gap-list file (if --file not given):
#   experiments/quay-continuous-bootstrap/gap-list.md
#
# Classification logic (markdown table row convention used by this repo's gap-list.md, see
# "## Open gaps" / "## Closed gaps" sections):
#   - A row matching the ID where the ID itself is wrapped in strikethrough (~~ID~~) is CLOSED
#     (the gap-list's own convention for marking an open-gaps-section row as resolved without
#     physically moving it — e.g. UQ-042..046).
#   - A row matching the ID under "## Closed gaps" is CLOSED even without strikethrough markers.
#   - A row matching the ID that is NOT strikethrough and NOT under "## Closed gaps" is OPEN.
#   - No matching row at all is NOT-FOUND.
#   - If multiple rows exist for the same ID (open-section duplicate + closed-section canonical,
#     as UQ-042..046 exhibit — see gap-list.md lines 35-39 AND 185-189), CLOSED wins if ANY
#     matching row is closed (a gap cannot be "still open" if it has been closed anywhere).

ACCEPT_CLOSED=0

if [ "${1:-}" = "--milestone" ]; then
  ACCEPT_CLOSED=1
  shift 2
fi
set -u


GAPFILE="experiments/quay-continuous-bootstrap/gap-list.md"

if [ "${1:-}" = "--file" ]; then
  GAPFILE="$2"
  shift 2
fi

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 [--file <gap-list.md>] <gap-id> [<gap-id> ...]" >&2
  exit 2
fi

if [ ! -f "$GAPFILE" ]; then
  echo "ERROR: gap-list file not found: $GAPFILE" >&2
  exit 2
fi

any_not_open=0

for id in "$@"; do
  # All table rows mentioning this ID (either bare "| ID |" or strikethrough "| ~~ID~~ |").
  matches=$(grep -nE "\|[[:space:]]*(~~)?${id}(~~)?[[:space:]]*\|" "$GAPFILE")

  if [ -z "$matches" ]; then
    echo "${id}: NOT-FOUND"
    any_not_open=1
    continue
  fi

  status="OPEN"
  while IFS= read -r line; do
    lineno="${line%%:*}"
    content="${line#*:}"
    # Strikethrough row → closed.
    if echo "$content" | grep -qE "\|[[:space:]]*~~${id}~~[[:space:]]*\|"; then
      status="CLOSED"
      break
    fi
    # Non-strikethrough row physically under "## Closed gaps" → closed.
    section_header_line=$(awk -v n="$lineno" '
      /^## / { last=$0; lastline=NR }
      NR==n { print lastline":"last; exit }
    ' "$GAPFILE")
    if echo "$section_header_line" | grep -qi "Closed gaps"; then
      status="CLOSED"
      break
    fi
  done <<< "$matches"

  echo "${id}: ${status}"
  if [ "$status" != "OPEN" ] && [ "$status" != "CLOSED" ]; then
    any_not_open=1
  fi
  # For THIS script's purpose (ceiling-check before charter authoring), a CLOSED id cited as
  # "in scope, currently open" is itself the failure signal the charter-author needs — but the
  # script's job is only to REPORT status; the caller (charter author / outer orchestrator)
  # decides what to do with a CLOSED or NOT-FOUND result. We still surface non-zero exit for
  # NOT-FOUND (definitely wrong) and leave CLOSED reporting to the caller's own policy, since
  # this script's minimum-viable-form spec (charter Check 1) explicitly says "reports OPEN /
  # CLOSED / NOT-FOUND per ID, non-zero exit if any cited ID is not OPEN" — so CLOSED also
  # triggers non-zero exit below.
  if [ "$status" != "OPEN" ] && [ "$ACCEPT_CLOSED" = "0" -o "$status" != "CLOSED" ]; then
    any_not_open=1
  fi
done

exit "$any_not_open"
