#!/usr/bin/env bash
# it0-impl-row-check.sh — design-only-milestone impl-row gate, charter
# M21-impl-row-enforcement Done-when clause 3 (DIR-016 item 2).
#
# Given a milestone id and its backlog.md row text (found in the backlog file), determines whether
# the milestone is DESIGN-ONLY, and if so, whether a corresponding non-DONE `<MILESTONE-ID>-IMPL`
# candidate row already exists in the same backlog file. Mirrors the existing `it0-*.sh` convention
# (see it0-gate-hash-check.sh, it0-ceiling-line-budget-check.sh): a real, working, fixture-testable
# mechanical check, not a narrative reminder.
#
# A milestone's `backlog.md` row is treated as DESIGN-ONLY when its row text (the full pipe-
# delimited line whose first `|`-column equals the given milestone id) matches EITHER:
#   - "design delivered"  (case-insensitive), OR
#   - "design-doc only" / "design only" / "design (doc only)"  (case-insensitive), OR
#   - "Done-when clauses a future implementing milestone" (case-insensitive) — i.e. the row's own
#     text names the dispatch-ready follow-up checklist convention this rule is built around.
# This mirrors the rule text in `inherited-core.md`'s "Design-only-milestone impl-row rule" section
# and `OUTER-LOOP.md` step 6's gate.
#
# A milestone is judged to already HAVE a satisfying `-IMPL` row when the backlog file contains ANY
# row whose first `|`-column is exactly `<MILESTONE-ID>-IMPL` — regardless of that row's OWN current
# DONE/pending status. The rule this script enforces (DIR-016 / M21-impl-row-enforcement) is that
# ABSORB must MATERIALIZE a selectable row at the time the design-only milestone completes, so
# SELECT can eventually reach it; it does not require the row to remain forever non-DONE — a
# `-IMPL` row that was created, later SELECTed, and is now itself DONE (e.g. `M-CLI-EDIT-PARITY-IMPL`,
# SELECTed and closed at m16) is exactly the rule working as intended, not a violation of it. "Was a
# row ever created" is the gate; a row's own subsequent lifecycle is out of this script's scope.
#
# Usage:
#   it0-impl-row-check.sh <milestone-id> [backlog-file]
#
# Exit codes:
#   0 = PASS — milestone is not design-only (rule does not apply), OR is design-only and a
#       `<MILESTONE-ID>-IMPL` row already exists (any status — see note above).
#   1 = FAIL/FLAG — milestone is design-only and no `<MILESTONE-ID>-IMPL` row was found at all.
#   2 = usage/file-not-found error (missing args, backlog file not found, or milestone id not found
#       in the backlog file at all).

set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <milestone-id> [backlog-file]" >&2
  exit 2
fi

MILESTONE_ID="$1"
BACKLOG_FILE="${2:-backlog.md}"

if [ ! -f "$BACKLOG_FILE" ]; then
  echo "ERROR: backlog file not found: $BACKLOG_FILE" >&2
  exit 2
fi

# Find the row whose first `|`-delimited column (after the leading `|`) is exactly MILESTONE_ID.
# Row format: "| M-FOO-BAR | ... | ... |" — match on "| <id> |" (word-bounded by pipes/space) to
# avoid a bare-substring false match (e.g. MILESTONE_ID being a prefix of a longer id).
milestone_row=$(grep -E "^\| ${MILESTONE_ID} \|" "$BACKLOG_FILE")

if [ -z "$milestone_row" ]; then
  echo "ERROR: no backlog row found for milestone id '$MILESTONE_ID' in $BACKLOG_FILE" >&2
  exit 2
fi

# --- Step 1: is this milestone design-only? ---
is_design_only=0
design_reason=""

if echo "$milestone_row" | grep -qiE 'design delivered'; then
  is_design_only=1
  design_reason="row text contains 'design delivered'"
elif echo "$milestone_row" | grep -qiE 'design[- ]doc only|design only|design \(doc only\)'; then
  is_design_only=1
  design_reason="row text contains a 'design-doc only' / 'design only' marker"
elif echo "$milestone_row" | grep -qiE 'Done-when clauses a future implementing milestone'; then
  is_design_only=1
  design_reason="row text names the 'Done-when clauses a future implementing milestone' follow-up checklist convention"
fi

if [ "$is_design_only" -eq 0 ]; then
  echo "PASS: $MILESTONE_ID is not design-only per its backlog row text (no 'design delivered' / 'design-doc only' / follow-up-checklist marker found) — impl-row gate does not apply."
  exit 0
fi

# --- Step 2: is there already a selectable, non-DONE <MILESTONE-ID>-IMPL row? ---
impl_id="${MILESTONE_ID}-IMPL"
impl_row=$(grep -E "^\| ${impl_id} \|" "$BACKLOG_FILE")

if [ -z "$impl_row" ]; then
  echo "FAIL: $MILESTONE_ID is design-only (${design_reason}), but no '${impl_id}' row was found in $BACKLOG_FILE. Per the design-only-milestone impl-row rule (DIR-016 / M21-impl-row-enforcement), ABSORB must create this selectable non-DONE row before milestone_counter++ may execute."
  exit 1
fi

echo "PASS: $MILESTONE_ID is design-only (${design_reason}), and a '${impl_id}' row already exists in $BACKLOG_FILE (row's own current status is out of this check's scope — see script header note)."
exit 0
