#!/usr/bin/env bash
# pipe-exit-code-check.sh — AC11 (gap-loop-mechanism-lives-outside-the-package-and-cannot-ship):
# 「管道后读 `$?`」做成可执行检查。
#
# WHY (the failure mode this closes): reading `$?` after a pipeline returns the LAST command in the
# pipeline, not the first. This family bit three times in two days (2026-08-02/03): archguard's lint
# was read as exit 0 (real 1), restart-readiness-check was read as 0 (real NOT READY), and the
# original incident — all through `cmd | cmd2 ...; echo $?` or a bare pipeline followed by a
# separate `echo $?`. One of the three happened TEN MINUTES after the rule was written into a tick
# doc — prose cannot stop a recurrence, a checker can (ADR-004: hard checks over prose).
#
# WHAT IT CATCHES (the two empirically-observed shapes; a documented heuristic, not a proof that
# every spelling is absent):
#   1. same-line  — a `|` followed later on the SAME line by a statement boundary (`;` `&&` `||`
#      `)`), followed by a `$?` read:
#        bash x | tail | sed; echo $?
#        a | b && c=$?
#   2. next-line  — a line reading `$?` whose previous non-blank line is a live pipeline (a `|`
#      with no statement boundary after its last `|`):
#        bash restart-readiness-check.sh | tail | sed
#        echo $?
#   The legitimate `echo $? | cat` (read $? BEFORE the pipe) is NOT flagged.
#
# Usage:
#   bash plugin/scripts/pipe-exit-code-check.sh [--self-check] [file.sh ...]
#     --self-check   run the built-in bad/good fixtures and exit accordingly (self-proof)
#     file.sh ...    scan the given files (default: plugin/scripts/*.sh — the shipped set)
# Exits 1 if any offending line is found (they are listed), 0 if clean.
#
# The scan is a SINGLE awk pass (no per-line process forking), so it stays fast even under the
# 4-core CPU pressure this repo runs at.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

AWK_PROG='BEGIN { found = 0 }
{
  line = $0
  lineno = NR
  # Crude comment strip: cut at the first `#` at start-of-line or preceded by whitespace.
  # (Approximation — a `#` inside a quoted string is rare in shell scripts; erring toward
  # not-stripping keeps prose from being flagged while tolerating a rare false cut.)
  stripped = line
  if (match(stripped, /(^|[ \t])#/)) {
    hash_at = RSTART + (substr(stripped, RSTART, 1) == "#" ? 0 : 1)
    stripped = substr(stripped, 1, hash_at - 1)
  }
  # Neutralize the logical-OR operator `||` (a control operator, NOT a pipeline) so a bare pipe
  # `|` is what the shapes detect. `a || b; echo $?` reads the whole expression status - fine;
  # `a | b; echo $?` reads the LAST pipeline component - the anti-pattern.
  scan = stripped
  gsub(/\|\|/, "\001", scan)
  # Shape 1: a pipe, later a boundary, later a literal `$?` (same line).
  # `\$[?]` is the ERE spelling of a literal `$?` — a bare `\$?` means "optional $" (matches empty),
  # which would flag every pipe-containing line.
  if (scan ~ /[|].*[;&|)].*\$[?]/) {
    printf "%s:%d: same-line pipeline then $? read (shape 1): %s\n", FILE, lineno, line
    found = 1
  }
  # Shape 2: a `$?` read on this line while the previous line was a live pipeline.
  if (scan ~ /\$[?]/ && prev_pipe) {
    printf "%s:%d: $? read follows a bare pipeline on the previous line (shape 2): %s\n", FILE, lineno, line
    found = 1
  }
  # Track live-pipeline for the NEXT line: this line has a `|`, and after its LAST `|` there is no
  # statement boundary (`;` `&&` `||` `)`), so the pipeline is still live at end of line.
  prev_pipe = 0
  if (scan ~ /[|]/) {
    last_pipe = 0
    for (i = 1; i <= length(scan); i++) if (substr(scan, i, 1) == "|") last_pipe = i
    after = substr(scan, last_pipe + 1)
    if (after !~ /[;&|)]/) prev_pipe = 1
  }
}
END { exit (found ? 1 : 0) }'

# scan_file <file>: run the awk pass over one file; print matches; exit 1 if any.
scan_file() {
  local file="$1"
  awk -v FILE="$file" "$AWK_PROG" "$file"
  return $?
}

self_check() {
  local bad good
  bad="$(mktemp)"; good="$(mktemp)"
  cat > "$bad" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
# A real incident shape: pipeline then echo $? on the same line
x=$(ls | wc -l); echo $?
# Another: bare pipeline then $? on the next line
bash restart-readiness-check.sh | tail | sed
echo $?
EOF
  cat > "$good" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
# Legitimate: read $? BEFORE the pipe (status of the previous command)
echo "$?" | cat
# Legitimate: no pipe at all
echo $?
# Legitimate: PIPESTATUS is the explicit way to read per-pipe status
ls | wc -l
echo "${PIPESTATUS[0]}"
EOF
  local rc_bad=0 rc_good=0
  scan_file "$bad" > /dev/null 2>&1 || rc_bad=$?
  scan_file "$good" > /dev/null 2>&1 || rc_good=$?
  rm -f "$bad" "$good"
  if [ "$rc_bad" = 1 ] && [ "$rc_good" = 0 ]; then
    echo "self-check PASS: bad pattern caught (exit 1), good file clean (exit 0)"
    return 0
  fi
  echo "self-check FAIL: bad rc=$rc_bad (want 1), good rc=$rc_good (want 0)" >&2
  return 1
}

if [ "${1:-}" = "--self-check" ]; then
  self_check
  exit $?
fi

FILES=("$@")
if [ ${#FILES[@]} -eq 0 ]; then
  # Default: the shipped plugin/scripts/*.sh set, EXCLUDING this checker itself — its source
  # intentionally embeds the anti-pattern as fixture data for --self-check, so scanning it would
  # self-flag (and there is nothing to check in a 25-line checker that has no real pipelines).
  FILES=()
  for f in "$SCRIPT_DIR"/*.sh; do
    [ "$(basename "$f")" = "pipe-exit-code-check.sh" ] && continue
    FILES+=("$f")
  done
fi

overall=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  scan_file "$f" || overall=1
done

if [ "$overall" = 1 ]; then
  echo "pipe-exit-code-check: ANTI-PATTERN FOUND (pipeline then \$? read) — see lines above." >&2
  exit 1
fi
echo "pipe-exit-code-check: clean (no pipeline-then-\$? reads)."
exit 0
