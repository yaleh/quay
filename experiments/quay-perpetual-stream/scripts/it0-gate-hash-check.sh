#!/usr/bin/env bash
# it0-gate-hash-check.sh — Check 2 (gate-hash/transclusion), charter M02-gates Done-when clause 2.
#
# Given a charter file, extracts its fenced "## HARD GATES" code block and diffs it against the
# current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines
# 100-131), ignoring lines the charter has explicitly tagged `[PARAM: ...]` (worktree/branch path
# and isolation-proof-target substitutions are the only sanctioned divergence — DIR-009). Any
# OTHER divergence FAILS this check and should block dispatch.
#
# Usage:
#   it0-gate-hash-check.sh <charter-file>
#
# Exit codes: 0 = PASS (charter's gate block matches the pinned source modulo declared PARAM
# lines); 1 = FAIL (undeclared divergence found — printed as a diff); 2 = usage/extraction error.

set -u

PINNED_SOURCE="experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md"
PINNED_START=100
PINNED_END=131

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <charter-file>" >&2
  exit 2
fi

CHARTER="$1"

if [ ! -f "$CHARTER" ]; then
  echo "ERROR: charter file not found: $CHARTER" >&2
  exit 2
fi

if [ ! -f "$PINNED_SOURCE" ]; then
  echo "ERROR: pinned source not found: $PINNED_SOURCE" >&2
  exit 2
fi

# Extract the FIRST fenced code block (```...```) that appears at or after the "## HARD GATES"
# heading in the charter. This is the charter's transcluded HARD GATES block.
gates_heading_line=$(grep -n "^## HARD GATES" "$CHARTER" | head -1 | cut -d: -f1)
if [ -z "$gates_heading_line" ]; then
  echo "ERROR: no '## HARD GATES' heading found in $CHARTER" >&2
  exit 2
fi

charter_block=$(awk -v start="$gates_heading_line" '
  NR < start { next }
  /^```/ { fence++; if (fence == 2) exit; next }
  fence == 1 { print }
' "$CHARTER")

if [ -z "$charter_block" ]; then
  echo "ERROR: no fenced code block found after '## HARD GATES' heading in $CHARTER" >&2
  exit 2
fi

pinned_block=$(sed -n "${PINNED_START},${PINNED_END}p" "$PINNED_SOURCE")
# Pinned source's own fenced markers (lines 100 and 131) are the ``` delimiters themselves;
# strip them so both sides compare pure gate-content lines only.
pinned_block=$(echo "$pinned_block" | sed '1{/^```$/d}; ${/^```$/d}')

# A line in the CHARTER block carrying a trailing `[PARAM: ...]` tag is a DECLARED, sanctioned
# substitution (worktree/branch path, directive-dir path) — DIR-009 permits the path content of
# that line (and, for the two-line "git worktree add ... -b ..." gate, its paired continuation
# line directly above/below) to diverge from the pinned source, but the [PARAM: ...] tag itself
# must be present in the charter (undeclared path changes are exactly what this check exists to
# catch). Both sides must have the SAME NUMBER OF LINES for this positional neutralization to be
# meaningful — if they don't, that's itself a real structural divergence and should show in the
# diff, not be silently swallowed, so we only neutralize when line counts match.
charter_line_count=$(echo "$charter_block" | wc -l)
pinned_line_count=$(echo "$pinned_block" | wc -l)

if [ "$charter_line_count" -eq "$pinned_line_count" ]; then
  # Determine, from the CHARTER side, which line numbers are PARAM-declared (that line itself,
  # plus — for the worktree/branch pair — the immediately preceding line if THIS line is a
  # "-b <branch>" continuation of a "git worktree add" line).
  param_lines=$(echo "$charter_block" | awk '
    { lines[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        if (lines[i] ~ /\[PARAM:.*\]/) {
          print i
          if (lines[i-1] ~ /git worktree add/) print i-1
        }
      }
    }
  ')
  charter_stripped=$(echo "$charter_block" | awk -v pl="$param_lines" '
    BEGIN { n = split(pl, arr, "\n"); for (j = 1; j <= n; j++) mark[arr[j]] = 1 }
    { if (mark[NR]) print "[PARAM-SUBSTITUTED-LINE]"; else print }
  ')
  pinned_stripped=$(echo "$pinned_block" | awk -v pl="$param_lines" '
    BEGIN { n = split(pl, arr, "\n"); for (j = 1; j <= n; j++) mark[arr[j]] = 1 }
    { if (mark[NR]) print "[PARAM-SUBSTITUTED-LINE]"; else print }
  ')
else
  # Line counts differ — do not attempt positional neutralization; let the raw diff surface the
  # structural mismatch (this itself fails the check, correctly).
  charter_stripped="$charter_block"
  pinned_stripped="$pinned_block"
fi

diff_output=$(diff <(echo "$pinned_stripped") <(echo "$charter_stripped"))
diff_status=$?

if [ "$diff_status" -eq 0 ]; then
  echo "PASS: $CHARTER HARD GATES block matches pinned source ($PINNED_SOURCE lines ${PINNED_START}-${PINNED_END}) modulo declared [PARAM: ...] substitutions."
  exit 0
else
  echo "FAIL: $CHARTER HARD GATES block diverges from pinned source ($PINNED_SOURCE lines ${PINNED_START}-${PINNED_END}) beyond declared [PARAM: ...] substitutions."
  echo "--- diff (pinned vs charter, declared [PARAM: ...] lines neutralized on both sides) ---"
  echo "$diff_output"
  exit 1
fi
