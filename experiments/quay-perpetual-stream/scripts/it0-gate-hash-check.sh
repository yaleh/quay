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
#   it0-gate-hash-check.sh <charter-file>                    # verbatim-transclusion mode (default)
#   it0-gate-hash-check.sh --by-reference <charter-file>      # by-reference mode (M06-sizing)
#
# By-reference mode (added M06-sizing, charter item 5): the charter file does NOT need to contain
# the fenced HARD GATES block at all. Instead it must contain a line of the exact form:
#   GATE-HASH-REF: <sha256-hex> (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)
# This script recomputes the sha256 of the CURRENT pinned block and compares it to the declared
# hash. A match means the charter's reference is verified current (the pinned source has not
# drifted since the hash was recorded) — PASS. A mismatch means the pinned source has changed
# since the charter cited it — FAIL, re-derive the charter's reference before dispatch. This mode
# only ever verifies the CHARTER FILE's reference; it says nothing about what a dispatched
# iteration-executor agent's actual prompt contains — that must independently be checked to
# contain the literal gate text (see OUTER-LOOP.md step 3's by-reference note).
#
# To (re-)derive a GATE-HASH-REF value by hand, matching exactly what this script computes:
#   sed -n '100,131p' experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md \
#     | sed '1{/^```$/d}; ${/^```$/d}' \
#     | { block=$(cat); printf '%s' "$block" | sha256sum; }
# (note: this strips the trailing newline via command substitution, same as the script — a naive
# `sha256sum` on a file with a trailing newline will NOT match; use the pipeline above, not `cat
# file | sha256sum`, when deriving a reference to paste into a charter.)
#
# Exit codes: 0 = PASS; 1 = FAIL (undeclared divergence, or hash mismatch in --by-reference mode);
# 2 = usage/extraction error.

set -u

PINNED_SOURCE="experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md"
PINNED_START=100
PINNED_END=131

BY_REFERENCE=0
if [ "${1:-}" = "--by-reference" ]; then
  BY_REFERENCE=1
  shift
fi

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 [--by-reference] <charter-file>" >&2
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

if [ "$BY_REFERENCE" -eq 1 ]; then
  pinned_block_raw=$(sed -n "${PINNED_START},${PINNED_END}p" "$PINNED_SOURCE" | sed '1{/^```$/d}; ${/^```$/d}')
  pinned_hash=$(printf '%s' "$pinned_block_raw" | sha256sum | cut -d' ' -f1)

  ref_line=$(grep -n "^GATE-HASH-REF:" "$CHARTER" | head -1)
  if [ -z "$ref_line" ]; then
    echo "ERROR: no 'GATE-HASH-REF: <sha256>' line found in $CHARTER (required for --by-reference mode)" >&2
    exit 2
  fi
  declared_hash=$(echo "$ref_line" | sed -E 's/^[0-9]+:GATE-HASH-REF:[[:space:]]*([0-9a-f]+).*/\1/')

  if [ "$declared_hash" = "$pinned_hash" ]; then
    echo "PASS: $CHARTER GATE-HASH-REF ($declared_hash) matches current pinned source ($PINNED_SOURCE lines ${PINNED_START}-${PINNED_END}) sha256."
    exit 0
  else
    echo "FAIL: $CHARTER GATE-HASH-REF ($declared_hash) does NOT match current pinned source sha256 ($pinned_hash) — pinned source has drifted since the charter cited it, or the declared hash is wrong. Re-derive before dispatch."
    exit 1
  fi
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
