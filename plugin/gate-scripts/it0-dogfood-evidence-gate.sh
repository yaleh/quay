#!/usr/bin/env bash
# it0-dogfood-evidence-gate.sh — Check 3 (dogfooding evidence-gate), charter M02-gates
# Done-when clause 3.
#
# Given an iteration report, flags Done-when-style claimed-met clauses (`- [x] ...` OR this
# repo's own `N. **MET.**` convention, see M01-dist iteration reports) that have no fenced code
# block (```...```) within N lines (default 40) in either direction. A claim with no nearby
# pasted-output block is exactly the "the build succeeded" prose-only pattern this experiment's
# charters explicitly forbid (cf. M01-dist charter Done-when clause framing: "pasted evidence, not
# 'the build succeeded'").
#
# This is intentionally a coarse proximity heuristic, not a full report-format validator — its job
# is to catch the OBVIOUS failure mode (a MET claim with zero fenced blocks anywhere nearby), not
# to adjudicate whether a given code block is actually relevant evidence for that specific clause.
#
# Usage:
#   it0-dogfood-evidence-gate.sh <iteration-report.md> [window-lines]
#   it0-dogfood-evidence-gate.sh --milestone <M-NN> [window-lines]
#
# With --milestone: scans only milestones/M<NN>/iterations/iteration-*.md (current milestone).
# Without --milestone: scans a single report file (existing behavior, backward-compatible).
#
# Exit codes: 0 = every claimed-met clause has a nearby fenced block; 1 = at least one
# claimed-met clause has NO fenced block within the window; 2 = usage error.

set -u

MILESTONE=""
if [ "${1:-}" = "--milestone" ]; then
  MILESTONE="$2"
  shift 2
fi

if [ "$#" -lt 1 ] && [ -z "$MILESTONE" ]; then
  echo "Usage: $0 [--milestone <M-NN>] <iteration-report.md> [window-lines]" >&2
  exit 2
fi

REPORT="${1:-}"
WINDOW="${2:-40}"

# When --milestone is provided, scan all iteration reports under that milestone directory.
if [ -n "$MILESTONE" ]; then
  # Probe for the milestone directory in both locations (repo-root for M130+, experiments/ for legacy).
  MILESTONE_ROOT=""
  for candidate in "milestones/${MILESTONE}" "experiments/quay-perpetual-stream/milestones/${MILESTONE}"; do
    if [ -d "$candidate" ]; then MILESTONE_ROOT="$candidate"; break; fi
  done
  if [ -z "$MILESTONE_ROOT" ]; then
    echo "Milestone directory not found for ${MILESTONE} — vacuously PASS."
    exit 0
  fi
  REPORTS=$(find "$MILESTONE_ROOT" -name 'iteration-*.md' 2>/dev/null | sort)
  if [ -z "$REPORTS" ]; then
    echo "No iteration reports found for milestone ${MILESTONE}."
    echo "Nothing to check — vacuously PASS."
    exit 0
  fi
  overall_fail=0
  for r in $REPORTS; do
    echo "--- $r ---"
    "$0" "$r" "$WINDOW" || overall_fail=1
  done
  exit $overall_fail
fi

if [ ! -f "$REPORT" ]; then
  echo "ERROR: report file not found: $REPORT" >&2
  exit 2
fi

# Precompute the line numbers of every fenced-block delimiter (```) in the file.
mapfile -t fence_lines < <(grep -n '^```' "$REPORT" | cut -d: -f1)

nearest_fence_distance() {
  local target="$1"
  local best=999999
  local f
  for f in "${fence_lines[@]}"; do
    local d=$(( f > target ? f - target : target - f ))
    if [ "$d" -lt "$best" ]; then
      best="$d"
    fi
  done
  echo "$best"
}

# Find claimed-met Done-when clause lines:
#   - [x] ... (standard checklist convention)
#   - "N. **MET.**" / "N. **MET (...)**" (this repo's Done-when-status-section convention,
#     see M01-dist iteration-0/iteration-1 reports §6/§7)
mapfile -t claim_lines < <(grep -nE '^\s*-\s*\[x\]|^\s*[0-9]+\.\s*\*\*MET' "$REPORT" | cut -d: -f1)

if [ "${#claim_lines[@]}" -eq 0 ]; then
  echo "No claimed-met Done-when-style clauses found in $REPORT (no '- [x]' or 'N. **MET' lines)."
  echo "Nothing to check — vacuously PASS."
  exit 0
fi

fail=0
for ln in "${claim_lines[@]}"; do
  clause_text=$(sed -n "${ln}p" "$REPORT")
  if [ "${#fence_lines[@]}" -eq 0 ]; then
    dist=999999
  else
    dist=$(nearest_fence_distance "$ln")
  fi
  if [ "$dist" -le "$WINDOW" ]; then
    echo "OK   line ${ln} (nearest fenced block ${dist} lines away, within window ${WINDOW}): ${clause_text}"
  else
    echo "FLAG line ${ln} (nearest fenced block ${dist} lines away, EXCEEDS window ${WINDOW} — no nearby pasted-output evidence): ${clause_text}"
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "PASS: all ${#claim_lines[@]} claimed-met clause(s) in $REPORT have a fenced code block within ${WINDOW} lines."
else
  echo "FAIL: at least one claimed-met clause in $REPORT lacks a nearby fenced code block (evidence gate)."
fi

exit "$fail"
