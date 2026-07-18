#!/usr/bin/env bash
# it0-impl-row-check.sh — Impl-row gate mechanical check, charter M21-impl-row-enforcement
# Done-when clause 3 (DIR-016 requested-action item 2).
#
# Given a milestone's backlog id (its `backlog.md` row id, e.g. `M-TASK-BACKLOG-PROJECTION`), scans
# `backlog.md` (default) or an explicitly-passed backlog file for that row and determines whether it
# is DESIGN-ONLY (its notes column contains "design delivered" / "design doc only" / "design-doc
# only", case-insensitive — the wording pattern the existing design-only rows already use, per
# `inherited-core.md`'s "Design-only milestone -> mandatory -IMPL row rule"). If the row IS
# design-only, this script then checks whether a corresponding `<id>-IMPL` row exists anywhere in
# the same backlog file (any row whose id column is exactly `<id>-IMPL`). Mirrors the existing
# `scripts/it0-*.sh` convention (exit 0/1/2, fixture-testable) — same shape as
# it0-gate-hash-check.sh / it0-ceiling-line-budget-check.sh.
#
# Usage:
#   it0-impl-row-check.sh <milestone-backlog-id> [backlog-file]
#
# Exit codes:
#   0 = PASS — either (a) the row is NOT design-only (this gate is a no-op for it), or (b) the row
#       IS design-only AND its `<id>-IMPL` row already exists in the backlog file.
#   1 = FAIL/FLAG — the row IS design-only and NO `<id>-IMPL` row exists in the backlog file. Per
#       the Impl-row gate (`OUTER-LOOP.md` step 6), this blocks `milestone_counter++` until the row
#       is created.
#   2 = usage/file-not-found/row-not-found error.

set -u

DEFAULT_BACKLOG="backlog.md"

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: $0 <milestone-backlog-id> [backlog-file]" >&2
  exit 2
fi

MID="$1"
BACKLOG="${2:-$DEFAULT_BACKLOG}"

if [ ! -f "$BACKLOG" ]; then
  echo "ERROR: backlog file not found: $BACKLOG" >&2
  exit 2
fi

# Find the row for MID: a markdown table row starting "| <MID> |" (exact id match, not a prefix —
# so M-FOO does not accidentally match M-FOO-IMPL's own row when searching for M-FOO).
row=$(grep -E "^\| ${MID} \|" "$BACKLOG")

if [ -z "$row" ]; then
  echo "ERROR: no backlog row found for id '$MID' in $BACKLOG (expected a line matching '| $MID | ...')" >&2
  exit 2
fi

# Design-only detection: the row's notes text contains "design delivered", "design doc only", or
# "design-doc only" (case-insensitive) — the exact phrasing the existing design-only rows
# (M-TASK-BACKLOG-PROJECTION, M-CLI-EDIT-PARITY, M-TASK-TO-PLAN-SKILL-DESIGN) already carry.
is_design_only=0
if echo "$row" | grep -qiE 'design deliver|design[- ]doc only'; then
  is_design_only=1
fi

if [ "$is_design_only" -eq 0 ]; then
  echo "PASS: '$MID' row in $BACKLOG is not design-only (no 'design delivered'/'design(-)doc only' marker found in its notes) — Impl-row gate is a no-op for this milestone."
  exit 0
fi

impl_id="${MID}-IMPL"
impl_row=$(grep -E "^\| ${impl_id} \|" "$BACKLOG")

if [ -n "$impl_row" ]; then
  echo "PASS: '$MID' row in $BACKLOG is design-only, AND its '$impl_id' row exists — Impl-row gate satisfied."
  exit 0
else
  echo "FAIL/FLAG: '$MID' row in $BACKLOG is design-only, but NO '$impl_id' row was found. Per the Impl-row gate (OUTER-LOOP.md step 6 / inherited-core.md's 'Design-only milestone -> mandatory -IMPL row rule', DIR-016), this milestone's ABSORB MUST create a selectable non-DONE '$impl_id' backlog row before milestone_counter++ (step 7) may execute."
  exit 1
fi
