#!/usr/bin/env bash
#
# readings.sh — context-slimming P0: the resident-injection + memory-consumption readings.
#
# Emits KEY=VALUE lines on stdout, one per line, nothing else:
#
#   repo_root=                  checkout the live CLAUDE.md was read from
#   memory_dir=                 memory directory the memory_* keys describe
#   transcripts_dir=            transcript corpus the memory-files-read key scanned
#   claude_md_lines=            lines in the live CLAUDE.md              (== wc -l)
#   claude_md_bytes=            bytes in the live CLAUDE.md              (== wc -c)
#   claude_md_longest_line=     longest line, in bytes (LC_ALL=C awk)
#   memory_index_lines=         lines in the live memory index (MEMORY.md)
#   memory_index_bytes=         bytes in the live memory index
#   memory_index_longest_line=  longest line, in bytes
#   memory_files_total=         *.md files under the memory directory
#   memory_files_read_14d=      distinct memory files opened by the Read tool inside the window
#   lookback_days=              the window actually used by the key above
#
# WHY THE KEY READS _14d EVEN WHEN --days DIFFERS: the key name is fixed by
# tasks/gap-context-slim-p0-baseline-readings.md AC2 (a consumer greps it literally).
# lookback_days= always reports the window really used, so the pair is never ambiguous.
#
# NOT-EVALUATED: an input that cannot be read yields the literal NOT-EVALUATED for every key
# derived from it, never 0. A fabricated 0 is indistinguishable from a genuine zero
# ("searched, found none") — which is exactly the false reading this task exists to prevent.
#
# WHY EVERY grep HERE IS SPELLED /usr/bin/grep: in this environment `grep` is a shell function
# that shells out to ugrep and silently returns nothing for some inputs (~/.claude/jobs among
# them) — a fake zero. The absolute path is the only reliable spelling. AC4 asserts this file
# carries no bare invocation; keep it that way when editing.
#
# LOWER BOUND: memory_files_read_14d counts only Read tool_use records whose file_path is the
# literal absolute memory-directory path. A read issued from Bash with a shell variable
# (`cat "$MEMDIR/x.md"`) is invisible here, so the number is a floor, not a total.
#
# Usage: readings.sh [--days N] [--memory-dir DIR] [--transcripts-dir DIR] [--repo-root DIR]
#
set -u

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

: "${HOME:?readings.sh: HOME is unset}"

DEFAULT_REPO_ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)
DEFAULT_MEMORY_DIR="$HOME/.claude/projects/-home-yale-work-quay/memory"

DAYS=14
MEMORY_DIR=''
TRANSCRIPTS_DIR=''
REPO_ROOT=''

usage() {
  printf 'usage: readings.sh [--days N] [--memory-dir DIR] [--transcripts-dir DIR] [--repo-root DIR]\n'
  printf '  --days N            lookback window in days for memory_files_read_14d (default %s)\n' "$DAYS"
  printf '  --memory-dir DIR    memory directory (default %s)\n' "$DEFAULT_MEMORY_DIR"
  printf '  --transcripts-dir   transcript corpus; defaults to the memory directory'"'"'s parent\n'
  printf '  --repo-root DIR     checkout holding the live CLAUDE.md (default %s)\n' "$DEFAULT_REPO_ROOT"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --days)            DAYS="${2:-}"; shift 2 || { usage >&2; exit 2; } ;;
    --memory-dir)      MEMORY_DIR="${2:-}"; shift 2 || { usage >&2; exit 2; } ;;
    --transcripts-dir) TRANSCRIPTS_DIR="${2:-}"; shift 2 || { usage >&2; exit 2; } ;;
    --repo-root)       REPO_ROOT="${2:-}"; shift 2 || { usage >&2; exit 2; } ;;
    -h|--help)         usage; exit 0 ;;
    *) printf 'readings.sh: unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$DAYS" in
  ''|*[!0-9]*) printf 'readings.sh: --days must be a positive integer, got: %s\n' "$DAYS" >&2; exit 2 ;;
esac
[ "$DAYS" -ge 1 ] || { printf 'readings.sh: --days must be >= 1\n' >&2; exit 2; }

# Defaults are resolved AFTER argument parsing so that --memory-dir also relocates the
# transcript corpus (the two live in the same project directory); --transcripts-dir overrides.
: "${MEMORY_DIR:=$DEFAULT_MEMORY_DIR}"
: "${REPO_ROOT:=$DEFAULT_REPO_ROOT}"
if [ -z "$TRANSCRIPTS_DIR" ]; then
  TRANSCRIPTS_DIR=$(dirname -- "$MEMORY_DIR")
fi
MEMORY_DIR="${MEMORY_DIR%/}"

# measure_file FILE -> "lines bytes longest", or NOT-EVALUATED three times if it is unreadable.
measure_file() {
  local f="$1" lines bytes longest
  if [ ! -f "$f" ] || [ ! -r "$f" ]; then
    printf 'NOT-EVALUATED NOT-EVALUATED NOT-EVALUATED\n'
    return 0
  fi
  lines=$(wc -l < "$f" 2>/dev/null) || lines=''
  bytes=$(wc -c < "$f" 2>/dev/null) || bytes=''
  # LC_ALL=C makes awk's length() count bytes, so this agrees with wc -c.
  longest=$(LC_ALL=C awk '{ if (length($0) > m) m = length($0) } END { if (m == "") m = 0; print m }' "$f" 2>/dev/null) || longest=''
  [ -n "$lines" ] || lines='NOT-EVALUATED'
  [ -n "$bytes" ] || bytes='NOT-EVALUATED'
  [ -n "$longest" ] || longest='NOT-EVALUATED'
  printf '%s %s %s\n' "$lines" "$bytes" "$longest"
}

# count_memory_files DIR -> number of *.md files under DIR, or NOT-EVALUATED.
count_memory_files() {
  local d="$1"
  if [ ! -d "$d" ] || [ ! -r "$d" ]; then
    printf 'NOT-EVALUATED\n'
    return 0
  fi
  find "$d" -type f -name '*.md' 2>/dev/null | wc -l
}

# count_memory_reads TRANSCRIPTS_DIR MEMORY_DIR DAYS -> distinct memory files the Read tool
# opened inside the window, or NOT-EVALUATED.
#
# Two filters, in this order:
#   1. file mtime within DAYS   — a file last written more than DAYS ago cannot hold a record
#                                 newer than DAYS, so this is a sound (cheap) prefilter.
#   2. record timestamp in window — a record's own timestamp, matched on the same line. The
#                                 mtime filter alone over-counts: a session resumed today still
#                                 contains reads it issued a month ago.
# The timestamps are compared by calendar date (local), so the window is the last DAYS calendar
# days, inclusive of today.
count_memory_reads() {
  local tdir="$1" mdir="$2" days="$3" esc dates pat xpat
  if [ ! -d "$mdir" ] || [ ! -r "$mdir" ]; then
    printf 'NOT-EVALUATED\n'
    return 0
  fi
  if [ ! -d "$tdir" ] || [ ! -r "$tdir" ]; then
    printf 'NOT-EVALUATED\n'
    return 0
  fi
  esc=$(printf '%s' "$mdir" | sed 's/[][\\.|$(){}?+*^]/\\&/g')
  dates=$(for i in $(seq 0 $((days - 1))); do date -d "-$i day" +%Y-%m-%d; done | paste -sd'|')
  # Match a Read tool_use whose file_path is inside the memory dir AND whose record carries an
  # in-window timestamp. The record's "timestamp" sits after the content block, hence the
  # trailing .* — grep is line-based, so .* cannot run past the record.
  pat='"name":"Read","input":{"file_path":"'"$esc"'/[^"]*".*"timestamp":"('"$dates"')'
  xpat="$esc"'/[^"]*"'
  find "$tdir" -name '*.jsonl' -mtime "-$days" -print0 2>/dev/null \
    | xargs -0 -r /usr/bin/grep -hoE "$pat" 2>/dev/null \
    | /usr/bin/grep -hoE "$xpat" 2>/dev/null \
    | sed -e 's|.*/||' -e 's|"$||' \
    | sort -u \
    | wc -l
}

read -r CM_LINES CM_BYTES CM_LONGEST < <(measure_file "$REPO_ROOT/CLAUDE.md")
read -r MI_LINES MI_BYTES MI_LONGEST < <(measure_file "$MEMORY_DIR/MEMORY.md")

MEM_FILES_TOTAL=$(count_memory_files "$MEMORY_DIR")
MEM_FILES_READ=$(count_memory_reads "$TRANSCRIPTS_DIR" "$MEMORY_DIR" "$DAYS")

# Keys derived from the memory directory share its fate: if the directory is gone, every
# memory_* key is NOT-EVALUATED rather than a plausible-looking zero.
if [ "$MEM_FILES_TOTAL" = 'NOT-EVALUATED' ]; then
  MI_LINES='NOT-EVALUATED'
  MI_BYTES='NOT-EVALUATED'
  MI_LONGEST='NOT-EVALUATED'
fi

printf 'repo_root=%s\n' "$REPO_ROOT"
printf 'memory_dir=%s\n' "$MEMORY_DIR"
printf 'transcripts_dir=%s\n' "$TRANSCRIPTS_DIR"
printf 'claude_md_lines=%s\n' "$CM_LINES"
printf 'claude_md_bytes=%s\n' "$CM_BYTES"
printf 'claude_md_longest_line=%s\n' "$CM_LONGEST"
printf 'memory_index_lines=%s\n' "$MI_LINES"
printf 'memory_index_bytes=%s\n' "$MI_BYTES"
printf 'memory_index_longest_line=%s\n' "$MI_LONGEST"
printf 'memory_files_total=%s\n' "$MEM_FILES_TOTAL"
printf 'memory_files_read_14d=%s\n' "$MEM_FILES_READ"
printf 'lookback_days=%s\n' "$DAYS"
exit 0
