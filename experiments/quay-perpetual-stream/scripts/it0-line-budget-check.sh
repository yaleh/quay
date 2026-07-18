#!/usr/bin/env bash
# it0-line-budget-check.sh — plan-time line-budget gate, charter M18-milestone-model-ceiling-and-
# diversity-policy Done-when clauses 2-3 (DIR-012 item 2 / requested-action item 2).
#
# Given a milestone charter file, flags whether the charter's declared/estimated scope plausibly
# exceeds the ~2000-line milestone ceiling (`inherited-core.md`, "Milestone-model ceiling" section;
# source: docs/proposals/exp5-quay-task-proposal-plan-skill.md §4) WITHOUT a nested phase/stage plan
# attached. This is the SELECT/charter-authoring-time gate the ceiling section itself requires
# ("a milestone charter that claims the ≤2000-line ceiling without a phase/stage plan attached has
# not earned the larger size") — mechanically checkable, not narrative-only, per this milestone's
# charter Done-when clause 2 and the M02-gates it0-*-check.sh precedent this script follows.
#
# What this script checks (in order):
#   1. Extract every explicit line-count figure the charter states for its own scope, via two
#      recognized declaration forms (see "Recognized charter conventions" below).
#   2. If no explicit figure is found, ESTIMATE a lower-bound proxy from the size of the charter's
#      own "In-scope work" section (line count of that section) — a coarse heuristic proxy for
#      "how much work does this charter's own text imply," not a substitute for a real line-budget
#      estimate a charter author should state explicitly. This proxy is intentionally conservative
#      (likely to UNDER-estimate real implementation-line scope) — it exists to catch a charter that
#      is CLEARLY headed for a large scope with nothing to gate it, not to be a precise sizer.
#   3. Check whether the charter contains a phase/stage plan reference (a `Phase` + `Stage` +
#      `≤500`/`≤200`-style line-budget structure, OR an explicit pointer to a separate plan document
#      such as `docs/plans/...`).
#   4. FLAG (non-zero exit) iff (declared-or-estimated scope > threshold) AND (no phase/stage plan
#      reference found). A charter under the threshold, or a charter over the threshold WITH a
#      phase/stage plan reference, PASSES.
#
# Recognized charter conventions for an explicit scope declaration (checked in this priority order):
#   a. A line of the form:  `Line budget: <N>`  or  `Estimated lines: <N>`  (case-insensitive) —
#      the sanctioned explicit form a charter author should use going forward.
#   b. A fenced budget block of the exact nested form this milestone's own inherited-core.md
#      amendment documents:
#        milestone ≤ ~<N> lines
#           phase  ≤ ~<M>  lines
#           stage  ≤ ~<K>  lines
#      — presence of this block form is itself treated as "has a phase/stage plan" (condition 3)
#      AND supplies <N> as the declared milestone-level figure.
#
# Usage:
#   it0-line-budget-check.sh <charter-file> [--threshold N]     (default threshold: 2000)
#
# Exit codes: 0 = PASS (under threshold, or over threshold WITH a phase/stage plan reference);
# 1 = FAIL/FLAG (plausibly over threshold, no phase/stage plan reference found); 2 = usage error.

set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <charter-file> [--threshold N]" >&2
  exit 2
fi

CHARTER="$1"
shift
THRESHOLD=2000

while [ "$#" -gt 0 ]; do
  case "$1" in
    --threshold)
      THRESHOLD="$2"
      shift 2
      ;;
    *)
      echo "ERROR: unrecognized argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ ! -f "$CHARTER" ]; then
  echo "ERROR: charter file not found: $CHARTER" >&2
  exit 2
fi

# --- Step 3 first (phase/stage plan detection) — needed regardless of which scope path is taken.

has_nested_budget_block=0
if grep -qE '^\s*milestone\s*(≤|<=)\s*~?[0-9,]+\s*lines' "$CHARTER" \
   && grep -qE '^\s*phase\s*(≤|<=)\s*~?[0-9,]+\s*lines' "$CHARTER" \
   && grep -qE '^\s*stage\s*(≤|<=)\s*~?[0-9,]+\s*lines' "$CHARTER"; then
  has_nested_budget_block=1
fi

has_phase_stage_headings=0
if grep -qiE '^\s*#{1,4}\s*Phase\s' "$CHARTER" && grep -qiE '^\s*#{1,4}\s*Stage\s' "$CHARTER"; then
  has_phase_stage_headings=1
fi

has_plan_doc_pointer=0
if grep -qE 'docs/plans/[0-9A-Za-z._-]+\.md' "$CHARTER"; then
  has_plan_doc_pointer=1
fi

has_plan=0
plan_evidence=""
if [ "$has_nested_budget_block" -eq 1 ]; then
  has_plan=1
  plan_evidence="nested milestone/phase/stage line-budget block found"
elif [ "$has_phase_stage_headings" -eq 1 ]; then
  has_plan=1
  plan_evidence="Phase + Stage headings found in charter body"
elif [ "$has_plan_doc_pointer" -eq 1 ]; then
  has_plan=1
  plan_evidence="explicit docs/plans/*.md pointer found"
fi

# --- Step 1: explicit declared scope figure.

declared_lines=""
declared_source=""

explicit_decl=$(grep -iE '^\s*(Line budget|Estimated lines)\s*:\s*[0-9,]+' "$CHARTER" | head -1)
if [ -n "$explicit_decl" ]; then
  declared_lines=$(echo "$explicit_decl" | grep -oE '[0-9,]+' | tail -1 | tr -d ',')
  declared_source="explicit '$(echo "$explicit_decl" | sed -E 's/^\s*//')' declaration"
elif [ "$has_nested_budget_block" -eq 1 ]; then
  declared_lines=$(grep -E '^\s*milestone\s*(≤|<=)\s*~?[0-9,]+\s*lines' "$CHARTER" \
    | head -1 | grep -oE '[0-9,]+' | head -1 | tr -d ',')
  declared_source="nested budget block's milestone figure"
fi

# --- Step 2: fallback proxy — size of the "In-scope work" section, if no explicit figure found.

estimate_source=""
estimate_lines=""
if [ -z "$declared_lines" ]; then
  # Extract from the first "## In-scope work..." (or "In scope") heading to the next "## " heading.
  section=$(awk '
    /^## .*[Ii]n[- ][Ss]cope/ { capture=1; next }
    /^## / { if (capture) exit }
    capture { print }
  ' "$CHARTER")
  estimate_lines=$(echo "$section" | grep -c '.')
  estimate_source="proxy: charter's own In-scope-work section line count ($estimate_lines lines of\
 charter text — NOT a real implementation-line estimate, only a coarse heuristic; charter should\
 state an explicit Line budget instead)"
fi

echo "Charter: $CHARTER"
echo "Threshold: $THRESHOLD lines"
if [ -n "$declared_lines" ]; then
  echo "Declared scope: ${declared_lines} lines (source: ${declared_source})"
  effective_lines="$declared_lines"
else
  echo "No explicit scope declaration found. $estimate_source"
  echo "(Proxy is a LOWER bound / coarse heuristic only — does not by itself confirm the charter is"
  echo " safely under threshold, only that nothing in the charter text itself signals a large scope.)"
  effective_lines="$estimate_lines"
fi

echo "Phase/stage plan reference: $( [ "$has_plan" -eq 1 ] && echo "FOUND ($plan_evidence)" || echo "NOT FOUND" )"

if [ "$effective_lines" -gt "$THRESHOLD" ] && [ "$has_plan" -eq 0 ]; then
  echo "FLAG: scope (${effective_lines}) plausibly exceeds the ${THRESHOLD}-line ceiling with NO"
  echo "      phase/stage plan reference found. Per inherited-core.md's Milestone-model ceiling"
  echo "      section, this charter has NOT earned the larger size — resize down to the existing"
  echo "      small-milestone norm, or attach a phase/stage plan (nested ≤500/≤200 budgets, or an"
  echo "      explicit docs/plans/*.md pointer) before dispatch."
  exit 1
fi

echo "PASS: either under the ${THRESHOLD}-line ceiling, or over it WITH a phase/stage plan reference."
exit 0
