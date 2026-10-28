#!/usr/bin/env bash
# it0-ceiling-line-budget-check.sh — plan-time line-budget gate, charter
# M18-milestone-model-ceiling-and-diversity-policy Done-when clauses 2-3 (DIR-012 item 2).
#
# Given a drafted charter file, flags whether the milestone's scope plausibly exceeds the
# ~2000-line milestone ceiling (`inherited-core.md`'s "Milestone ceiling expansion" subsection)
# WITHOUT an accompanying phase/stage decomposition plan. This mechanizes the SELECT/charter-
# authoring-time check `OUTER-LOOP.md` step 1 requires — a real gate, not a narrative reminder —
# following the same "extract a signal from the charter text, PASS/FAIL on it" shape as
# it0-gate-hash-check.sh (Check 2) and it0-ceiling-check.sh (Check 1).
#
# What counts as "a phase/stage plan is present" (ANY of these satisfies it):
#   - The charter text itself contains a `Phase` heading/label AND a `Stage` heading/label
#     (case-insensitive), e.g. an inlined "## Phase 1" / "Stage 1:" structure.
#   - The charter text contains a `Plan:` line pointing at an external plan document (the
#     `docs/plans/N-*.md` convention this repo already uses, e.g.
#     `docs/plans/3-7-quay-task-to-plan-skill.md`), and that referenced file itself contains
#     both `Phase` and `Stage` markers.
#
# What counts as "scope plausibly exceeds ~2000 lines" (the trigger for requiring a plan):
#   - An explicit `Line budget: <N>` (or `Estimated lines: <N>` / `~<N> lines`) declaration in
#     the charter with N > 2000, OR
#   - No explicit line-budget declaration AND the charter's own "In-scope work" section lists
#     more than a configurable item-count threshold (default 8) of top-level numbered items —
#     a coarse proxy for "this plausibly doesn't fit the small-milestone norm," per the
#     charter's own "at charter-authoring judgment, plausibly exceed that" language (M18 charter,
#     in-scope item 2). This proxy is deliberately conservative/coarse (like the dogfood-evidence-
#     gate's proximity heuristic) — its job is to catch the OBVIOUS unplanned-oversized case, not
#     to adjudicate borderline charters exactly.
#
# Usage:
#   it0-ceiling-line-budget-check.sh <charter-file> [item-count-threshold]
#
# Exit codes:
#   0 = PASS (small-milestone norm, no budget claim over ~2000 AND item count under threshold;
#       OR a budget/scope over the norm IS accompanied by a phase/stage plan).
#   1 = FAIL/FLAG (scope plausibly exceeds ~2000 lines / small-milestone norm, with NO phase/stage
#       plan reference found — charter must be resized or given a plan before dispatch).
#   2 = usage/file-not-found error.

set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <charter-file> [item-count-threshold]" >&2
  exit 2
fi

CHARTER="$1"
THRESHOLD="${2:-8}"

if [ ! -f "$CHARTER" ]; then
  echo "ERROR: charter file not found: $CHARTER" >&2
  exit 2
fi

# --- Step 1: does the charter declare an explicit line budget? ---
declared_budget=$(grep -oiE '(Line budget|Estimated lines)[[:space:]:]*[~]?[0-9]+' "$CHARTER" \
  | grep -oE '[0-9]+' | head -1)

over_budget=0
budget_reason=""

if [ -n "${declared_budget:-}" ]; then
  if [ "$declared_budget" -gt 2000 ]; then
    over_budget=1
    budget_reason="declared line budget ${declared_budget} > 2000"
  fi
else
  # --- Step 2 (proxy, only when no explicit budget declared): count top-level numbered
  # in-scope items under an "In-scope work" heading. ---
  in_scope_line=$(grep -niE '^#+[[:space:]]*In-scope work' "$CHARTER" | head -1 | cut -d: -f1)
  if [ -n "$in_scope_line" ]; then
    item_count=$(awk -v start="$in_scope_line" '
      NR <= start { next }
      /^#+[[:space:]]/ { exit }
      /^[0-9]+\.[[:space:]]/ { n++ }
      END { print n+0 }
    ' "$CHARTER")
    if [ "$item_count" -gt "$THRESHOLD" ]; then
      over_budget=1
      budget_reason="In-scope work section has ${item_count} top-level numbered items (> threshold ${THRESHOLD}), no explicit line-budget declaration to override the proxy"
    fi
  fi
fi

if [ "$over_budget" -eq 0 ]; then
  echo "PASS: $CHARTER — scope within the small-milestone norm (no declared line budget > 2000, in-scope item count at or under threshold ${THRESHOLD}). No phase/stage plan required."
  exit 0
fi

# --- Step 3: scope plausibly exceeds the norm — a phase/stage plan MUST be present. ---
# Deliberately STRICT structural match (a heading/label line, not incidental prose mention of the
# word "phase"/"stage" anywhere in the file — e.g. a charter's own narrative description of THIS
# gate, or an "Explicitly OUT of scope" bullet, must not count as "having a plan"). Matches:
#   "## Phase 1", "### Phase: foo", "Phase 1:", "Phase 1 -" — a markdown heading OR a
#   line-leading "Phase <N>" label; same shape for "Stage".
is_plan_structure() {
  local file="$1"
  local phase_hits stage_hits
  phase_hits=$(grep -ciE '^(#+[[:space:]]*)?Phase[[:space:]]*[0-9]+([[:space:]:.\-]|$)' "$file" 2>/dev/null || true)
  stage_hits=$(grep -ciE '^(#+[[:space:]]*)?Stage[[:space:]]*[0-9]+([[:space:]:.\-]|$)' "$file" 2>/dev/null || true)
  if [ "${phase_hits:-0}" -gt 0 ] && [ "${stage_hits:-0}" -gt 0 ]; then
    return 0
  fi
  return 1
}

has_inline_plan_flag=0
if is_plan_structure "$CHARTER"; then
  has_inline_plan_flag=1
fi

plan_line=$(grep -nE '^Plan:[[:space:]]*\S' "$CHARTER" | head -1)
has_external_plan=0
external_plan_path=""
if [ -n "$plan_line" ]; then
  external_plan_path=$(echo "$plan_line" | sed -E 's/^[0-9]+:Plan:[[:space:]]*//' | awk '{print $1}')
  # Resolve relative to repo root (script is expected to be run from repo root, matching the
  # existing scripts' convention of relative gap-list/pinned-source paths).
  if [ -f "$external_plan_path" ] && is_plan_structure "$external_plan_path"; then
    has_external_plan=1
  fi
fi

if [ "$has_inline_plan_flag" -eq 1 ] || [ "$has_external_plan" -eq 1 ]; then
  plan_source="inline Phase/Stage structure"
  if [ "$has_external_plan" -eq 1 ]; then
    plan_source="external plan document ($external_plan_path, Phase/Stage markers confirmed)"
  fi
  echo "PASS: $CHARTER — scope plausibly exceeds the small-milestone norm (${budget_reason}), BUT a phase/stage plan is present (${plan_source}). Per inherited-core.md's ceiling-expansion rule, this is safe."
  exit 0
fi

echo "FAIL/FLAG: $CHARTER — scope plausibly exceeds the small-milestone norm (${budget_reason}), and NO phase/stage plan was found (no inline Phase+Stage structure, no 'Plan: <path>' line resolving to a document with both Phase and Stage markers)."
echo "Per inherited-core.md's 'Milestone ceiling expansion' subsection: a milestone sized above the small-milestone norm is safe ONLY when decomposed via a phase/stage plan. Fix by adding a phase/stage plan reference, or resize/split this candidate, before dispatch."
exit 1
