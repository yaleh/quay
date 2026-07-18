#!/usr/bin/env bash
# it0-dir-projection-check.sh — anti-drift reconciliation check, charter M05-dir-projection
# Done-when clause 3 (DIR-002's "mechanical enforcement it15 identified as missing but never
# built").
#
# Compares the live task store's `label: directive` tasks against the DIR-NNN.md files under
# experiments/<EXPERIMENT>/directives/{pending,archive,retracted}/ and FAILS (non-zero exit) on
# either of two divergence modes:
#   (a) TASK-WITH-NO-FILE — a `label: directive` task exists whose id has no corresponding
#       DIR-NNN.md file anywhere in pending/archive/retracted.
#   (b) STATUS-DISAGREEMENT — a DIR-NNN.md file's own `status:` frontmatter line disagrees with
#       its projected task's status-mirror field (checked in `extra.dirStatus` first, falling
#       back to parsing the body's `Status mirror: <value>` line if `extra.dirStatus` is absent).
#
# A task with a real, matching file and an agreeing status mirror is not an error — that is the
# expected, healthy projection state (files canonical, task is a generated projection of it).
#
# Usage:
#   it0-dir-projection-check.sh <experiment-dir> [tasks-json-file]
#
#   <experiment-dir>    e.g. experiments/quay-perpetual-stream (the dir containing directives/)
#   [tasks-json-file]   optional: a pre-fetched `task list --labels directive --json` file to
#                        check against (lets this run be tested/demonstrated deterministically
#                        without a live MCP/CLI round-trip each time). If omitted, this script
#                        invokes `node packages/quay/bin/quay.js task list --labels directive
#                        --json` itself (requires being run from the repo root with node on PATH).
#
# Exit codes: 0 = PASS (no divergence found); 1 = FAIL (at least one divergence found, listed);
# 2 = usage/data error.

set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <experiment-dir> [tasks-json-file]" >&2
  exit 2
fi

EXP_DIR="$1"
TASKS_JSON_FILE="${2:-}"
DIRECTIVES_DIR="${EXP_DIR}/directives"

if [ ! -d "$DIRECTIVES_DIR" ]; then
  echo "ERROR: directives dir not found: $DIRECTIVES_DIR" >&2
  exit 2
fi

if [ -n "$TASKS_JSON_FILE" ]; then
  if [ ! -f "$TASKS_JSON_FILE" ]; then
    echo "ERROR: tasks JSON file not found: $TASKS_JSON_FILE" >&2
    exit 2
  fi
  TASKS_JSON=$(cat "$TASKS_JSON_FILE")
else
  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node not on PATH and no tasks-json-file supplied" >&2
    exit 2
  fi
  # Strip the native provider's stderr-ish banner line ("quay-native mcp: serving tasks from
  # ...") that the CLI currently prints to stdout ahead of the JSON payload on some invocations.
  RAW_OUT=$(node packages/quay/bin/quay.js task list --labels directive --json 2>/dev/null)
  TASKS_JSON=$(echo "$RAW_OUT" | awk '/^\[/{found=1} found{print}')
  if [ -z "$TASKS_JSON" ]; then
    echo "ERROR: could not obtain task list JSON (empty output)" >&2
    exit 2
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required to parse task JSON" >&2
  exit 2
fi

# Build a map of DIR-NNN -> status by scanning every DIR-*.md file under pending/archive/retracted.
FILE_STATUS_TMP=$(mktemp)
trap 'rm -f "$FILE_STATUS_TMP"' EXIT

for sub in pending archive retracted; do
  d="${DIRECTIVES_DIR}/${sub}"
  [ -d "$d" ] || continue
  for f in "$d"/DIR-*.md; do
    [ -e "$f" ] || continue
    id=$(basename "$f" | grep -oE '^DIR-[0-9]+')
    [ -n "$id" ] || continue
    status_line=$(grep -m1 -E '^\s*-\s*status:' "$f" | sed -E 's/^\s*-\s*status:\s*//' | sed -E 's/\s*(\(.*\))?\s*$//' | awk '{print $1}')
    echo "${id}	${status_line}	${f}" >> "$FILE_STATUS_TMP"
  done
done

# Stage the tasks JSON to a temp file too, so the node subprocess never has to receive JSON
# through shell-quoted inline source (fragile with embedded quotes/newlines in task bodies).
TASKS_JSON_TMP=$(mktemp)
trap 'rm -f "$FILE_STATUS_TMP" "$TASKS_JSON_TMP"' EXIT
printf '%s' "$TASKS_JSON" > "$TASKS_JSON_TMP"

# Use node to do the JSON parsing + comparison (avoids a jq dependency, consistent with this
# repo's existing scripts preferring node/awk over requiring extra tooling).
export FILE_STATUS_TMP TASKS_JSON_TMP
node "$(dirname "$0")/it0-dir-projection-check.mjs"
STATUS=$?
exit $STATUS
