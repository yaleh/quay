#!/usr/bin/env bash
#
# readings-selfcheck.sh — dry-runs readings.sh against a known-true sample and known-missing
# input, so that "0" from readings.sh can never be mistaken for "I could not look".
#
# Arms (all must pass; exit 0 iff every arm passes):
#
#   1. TRUE SAMPLE   A real transcript — taken verbatim from the production corpus, not
#                    fabricated — that is known to contain at least one Read of a memory file
#                    is copied alone into a scratch corpus. readings.sh is pointed at it and
#                    must report memory_files_read_14d >= 1. This is the positive control: it
#                    proves the counter can fire, on real Claude Code transcript bytes.
#                    The lookback window is derived from the sample's own oldest record (plus a
#                    2-day margin), so the arm does not depend on when the sample was produced —
#                    a pinned window here would go red the moment the sample aged out of it.
#
#   2. MISSING MEMORY DIR
#                    readings.sh is pointed at a memory directory that does not exist. Every
#                    memory_* key must read NOT-EVALUATED and none may read 0. This is the arm
#                    that pins the failure mode the task exists to prevent: an absent input
#                    masquerading as a genuine zero.
#
#   3. EMPTY CORPUS  readings.sh is pointed at a corpus directory that really exists and really
#                    holds no transcripts, with the real memory directory. memory_files_read_14d
#                    must be 0 — a genuine zero. Arms 2 and 3 together prove the script can tell
#                    "searched, found none" apart from "could not search": same-shaped output
#                    only if it cannot.
#
# WHY EVERY grep HERE IS SPELLED /usr/bin/grep: see the header of readings.sh — the bare name is
# a ugrep wrapper in this environment and silently returns nothing for some inputs.
#
# Usage: readings-selfcheck.sh [--transcripts-dir DIR] [--memory-dir DIR]
#
set -u

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
READINGS="$SCRIPT_DIR/readings.sh"

: "${HOME:?readings-selfcheck.sh: HOME is unset}"

DEFAULT_TRANSCRIPTS_DIR="$HOME/.claude/projects/-home-yale-work-quay"
TRANSCRIPTS_DIR=''
MEMORY_DIR=''

usage() {
  printf 'usage: readings-selfcheck.sh [--transcripts-dir DIR] [--memory-dir DIR]\n'
  printf '  --transcripts-dir DIR  production transcript corpus to draw the sample from\n'
  printf '                         (default %s)\n' "$DEFAULT_TRANSCRIPTS_DIR"
  printf '  --memory-dir DIR       production memory directory (default <transcripts-dir>/memory)\n'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --transcripts-dir) TRANSCRIPTS_DIR="${2:-}"; shift 2 || { usage >&2; exit 2; } ;;
    --memory-dir)      MEMORY_DIR="${2:-}"; shift 2 || { usage >&2; exit 2; } ;;
    -h|--help)         usage; exit 0 ;;
    *) printf 'readings-selfcheck.sh: unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done
: "${TRANSCRIPTS_DIR:=$DEFAULT_TRANSCRIPTS_DIR}"
: "${MEMORY_DIR:=$TRANSCRIPTS_DIR/memory}"
MEMORY_DIR="${MEMORY_DIR%/}"
TRANSCRIPTS_DIR="${TRANSCRIPTS_DIR%/}"

FAILED=0
TMP=''
trap '[ -n "$TMP" ] && rm -rf "$TMP"' EXIT

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
note() { printf '      %s\n' "$1"; }

# get_key OUTPUT KEY -> the value of KEY= in OUTPUT (empty if absent)
get_key() { printf '%s\n' "$1" | sed -n "s/^$2=//p"; }

# is_uint VALUE -> 0 iff VALUE is a non-empty run of digits
is_uint() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

if [ ! -r "$READINGS" ]; then
  printf 'readings-selfcheck.sh: cannot read %s\n' "$READINGS" >&2
  exit 2
fi

TMP=$(mktemp -d) || { printf 'readings-selfcheck.sh: mktemp failed\n' >&2; exit 2; }

# ---------------------------------------------------------------- arm 1: known-true sample
esc=$(printf '%s' "$MEMORY_DIR" | sed 's/[][\\.|$(){}?+*^]/\\&/g')
sample_pat='"name":"Read","input":{"file_path":"'"$esc"'/'

# Prefer a recently written transcript (cheap scan); fall back to the whole corpus so a quiet
# week cannot make this arm vanish. Sorted so the pick is deterministic for a given corpus.
sample=$(find "$TRANSCRIPTS_DIR" -name '*.jsonl' -mtime -60 -print0 2>/dev/null \
  | xargs -0 -r /usr/bin/grep -lE "$sample_pat" 2>/dev/null | sort | head -1)
if [ -z "$sample" ]; then
  sample=$(find "$TRANSCRIPTS_DIR" -name '*.jsonl' -print0 2>/dev/null \
    | xargs -0 -r /usr/bin/grep -lE "$sample_pat" 2>/dev/null | sort | head -1)
fi

if [ -z "$sample" ]; then
  # Not a soft skip: the arm's premise ("a real sample exists") is what is being asserted, and
  # reporting PASS here would be a green light from a check that never looked at anything.
  fail "arm 1 (true sample): no transcript under $TRANSCRIPTS_DIR contains a Read of $MEMORY_DIR"
  note "the true-sample arm cannot be evaluated on this corpus; NOT-EVALUATED"
else
  note "arm 1 sample: $sample"
  mkdir -p "$TMP/corpus-true"
  cp "$sample" "$TMP/corpus-true/"

  oldest=$(/usr/bin/grep -oE '"timestamp":"[0-9]{4}-[0-9]{2}-[0-9]{2}' "$sample" 2>/dev/null \
    | sed 's/.*"//' | sort | head -1)
  oldest_epoch=$(date -d "$oldest" +%s 2>/dev/null) || oldest_epoch=''
  if [ -z "$oldest" ] || [ -z "$oldest_epoch" ]; then
    fail "arm 1 (true sample): could not derive a lookback window from $sample"
    note "no parseable record timestamp; NOT-EVALUATED"
  else
    sample_days=$(( ( $(date +%s) - oldest_epoch ) / 86400 + 2 ))
    note "arm 1 window: --days $sample_days (sample's oldest record is $oldest)"
    out1=$(bash "$READINGS" --days "$sample_days" \
      --memory-dir "$MEMORY_DIR" --transcripts-dir "$TMP/corpus-true" 2>/dev/null)
    rc1=$?
    val1=$(get_key "$out1" memory_files_read_14d)
    if [ "$rc1" -ne 0 ]; then
      fail "arm 1 (true sample): readings.sh exited $rc1"
    elif ! is_uint "$val1"; then
      fail "arm 1 (true sample): memory_files_read_14d=$val1 (expected an integer >= 1)"
    elif [ "$val1" -ge 1 ]; then
      pass "arm 1 (true sample): memory_files_read_14d=$val1 >= 1"
    else
      fail "arm 1 (true sample): memory_files_read_14d=$val1, expected >= 1 on a corpus that provably contains one"
    fi
  fi
fi

# ------------------------------------------------------- arm 2: memory directory does not exist
missing="$TMP/no-such-memory-dir"
out2=$(bash "$READINGS" --days 14 \
  --memory-dir "$missing" --transcripts-dir "$TMP/corpus-true" 2>/dev/null)
rc2=$?
if [ "$rc2" -ne 0 ]; then
  fail "arm 2 (missing memory dir): readings.sh exited $rc2"
else
  bad_keys=''
  for k in memory_index_lines memory_index_bytes memory_index_longest_line \
           memory_files_total memory_files_read_14d; do
    v=$(get_key "$out2" "$k")
    if [ "$v" != 'NOT-EVALUATED' ]; then
      bad_keys="$bad_keys $k=$v"
    fi
  done
  if [ -n "$bad_keys" ]; then
    fail "arm 2 (missing memory dir): expected NOT-EVALUATED, got:$bad_keys"
  else
    pass "arm 2 (missing memory dir): all 5 memory_* keys read NOT-EVALUATED, none read 0"
  fi
fi

# ------------------------------------------------------------- arm 3: real but empty corpus
mkdir -p "$TMP/corpus-empty"
out3=$(bash "$READINGS" --days 14 \
  --memory-dir "$MEMORY_DIR" --transcripts-dir "$TMP/corpus-empty" 2>/dev/null)
rc3=$?
if [ "$rc3" -ne 0 ]; then
  fail "arm 3 (empty corpus): readings.sh exited $rc3"
else
  val3=$(get_key "$out3" memory_files_read_14d)
  tot3=$(get_key "$out3" memory_files_total)
  if [ "$val3" != '0' ]; then
    fail "arm 3 (empty corpus): memory_files_read_14d=$val3, expected a genuine 0"
  elif [ "$tot3" = 'NOT-EVALUATED' ] || ! is_uint "$tot3"; then
    fail "arm 3 (empty corpus): memory_files_total=$tot3, expected the real memory file count"
  else
    pass "arm 3 (empty corpus): memory_files_read_14d=0 (genuine zero) while memory_files_total=$tot3"
  fi
fi

printf '\n'
if [ "$FAILED" -eq 0 ]; then
  printf 'readings-selfcheck: PASS (3/3 arms)\n'
  exit 0
fi
printf 'readings-selfcheck: FAIL (%s arm(s) failed)\n' "$FAILED"
exit 1
