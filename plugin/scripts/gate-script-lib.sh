#!/usr/bin/env bash
# gate-script-lib.sh — shared framework primitives for quay gate check + selfcheck scripts.
# Source this file at the top of your gate script, then call the functions below.
#
# Usage:
#   source "$(dirname "$0")/gate-script-lib.sh"
#   # or, when sourcing from experiment root in a selfcheck:
#   source "scripts/gate-script-lib.sh"
#
# Functions:
#   gate_delegate_ts <ts_basename> <min_args> <usage> "$@"
#       Validate args + node, then exec the TS script (replaces shell process).
#   gate_run_selfcheck <check_cmd> <extra_args...>
#       Run a fixture-based selfcheck. CASES must be defined as a bash array
#       with pipe-delimited entries: "id|fixture-file|expected-exit-code".
#   gate_read_yaml_field <file> <field>
#       Read a YAML frontmatter field value from a markdown file.
#   gate_resolve_milestone_root <M-NN or NN>
#       Single-sourced milestones/ path-prefix rule (ADR-004; gap-absorb-charter-audit-not-committed
#       / M176). Echoes the repo-root-relative directory a given milestone number resolves to.
#   gate_emit_pass <msg>   /   gate_emit_fail <msg>
#       Standardized PASS / FAIL lines.

# ── gate_delegate_ts ────────────────────────────────────────────────────────────────────────────────
# Delegate to a TypeScript check script via node, replacing the shell process.
# Validates minimum arg count and node availability before delegating.
#
# Usage: gate_delegate_ts <ts_basename> <min_args> <usage> "$@"
#   ts_basename  — TS filename relative to the library's own directory (e.g. "task-schema-check.ts")
#   min_args     — minimum number of positional args required
#   usage        — usage string for the error message (e.g. "<task-file.md> [<task-file.md> ...]")
gate_delegate_ts() {
  local _ts="${1:?}" _min="${2:-1}" _usage="${3:-}"
  shift 3

  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node required" >&2
    exit 2
  fi

  local _actual=$#
  if [ "$_actual" -lt "$_min" ]; then
    echo "Usage: $(basename "$0") $_usage" >&2
    exit 2
  fi

  local _dir
  _dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  exec node "$_dir/$_ts" "$@"
}

# ── gate_run_selfcheck ──────────────────────────────────────────────────────────────────────────────
# Run a fixture-based selfcheck against a check command.
# CASES must be defined as a bash array before calling this function.
# Two entry formats are supported:
#   3-field: "id|fixture-file|expected-exit-code"                 (no per-case extra args)
#   4-field: "id|fixture-file|extra-args|expected-exit-code"      (per-case extra args, word-split)
#
# Usage: gate_run_selfcheck <check_cmd>
#   check_cmd    — path to the check script (e.g. "./scripts/task-schema-check.sh")
#
# Sets -u, changes to experiment root (parent of the library's own scripts/ dir),
# then runs each CASES entry against the check command and prints PASS/FAIL per fixture.
# Exits 0 if all fixtures match expected; exits 1 if any mismatch.
gate_run_selfcheck() {
  set -u
  local _check="${1:?}"

  local _exp_root
  _exp_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$_exp_root" || { echo "ERROR: cannot cd to experiment root" >&2; exit 2; }

  [ -x "$_check" ] || { echo "ERROR: $_check not found/executable" >&2; exit 2; }

  local _fail=0 _total=0
  for _c in "${CASES[@]}"; do
    # Detect 3-field vs 4-field format by counting pipe characters.
    local _pipes
    _pipes=$(echo "$_c" | tr -cd '|' | wc -c)
    if [ "$_pipes" -ge 3 ]; then
      # 4-field: id|file|extra|want — word-split extra args
      IFS='|' read -r _id _file _extra _want <<< "$_c"
      _total=$((_total + 1))
      # shellcheck disable=SC2086
      "$_check" $_extra "$_file" >/dev/null 2>&1
    else
      # 3-field: id|file|want — no per-case extra args
      IFS='|' read -r _id _file _want <<< "$_c"
      _total=$((_total + 1))
      "$_check" "$_file" >/dev/null 2>&1
    fi
    local _got=$?
    if [ "$_got" = "$_want" ]; then
      echo "PASS: $_id — exit $_got (expected $_want) [$_file]"
    else
      echo "FAIL: $_id — exit $_got but EXPECTED $_want [$_file]"
      _fail=1
    fi
  done

  echo
  if [ "$_fail" = 0 ]; then
    echo "PASS: all $_total fixtures behaved as asserted."
    exit 0
  else
    echo "FAIL: at least one fixture did not behave as asserted (see above)."
    echo "      The fix belongs in the check module, NOT in the fixtures (DIR-019 discipline)."
    exit 1
  fi
}

# ── gate_read_yaml_field ────────────────────────────────────────────────────────────────────────────
# Read a single YAML frontmatter field from a markdown file.
# Returns the field value on stdout (no trailing newline). Empty string if not found.
#
# Usage: value=$(gate_read_yaml_field <file> <field>)
gate_read_yaml_field() {
  local _file="${1:?}" _field="${2:?}"
  [ -f "$_file" ] || { echo "ERROR: file not found: $_file" >&2; return 1; }
  python3 -c "
import sys, re
with open(sys.argv[1]) as f:
    text = f.read()
m = re.match(r'^---\s*\n(.*?)\n---', text, re.DOTALL)
if not m:
    sys.exit(0)
front = m.group(1)
for line in front.split('\n'):
    line = line.strip()
    if line.startswith('${_field}:'):
        val = line.split(':', 1)[1].strip()
        print(val, end='')
        break
" "$_file"
}

# ── gate_resolve_milestone_root ─────────────────────────────────────────────────────────────────────
# THE single authoritative rule for which `milestones/` tree a given milestone number lives under
# (gap-absorb-charter-audit-not-committed / M176, root cause 3). Every other script or prompt that
# needs to resolve a milestone's evidence directory MUST call this function rather than re-deriving
# the boundary itself (grep for "130" outside this function is a single-source violation).
#
# Rule: milestone number >= 130 → top-level `milestones/M<NN>` (current, M130+);
#       milestone number <  130 → legacy `experiments/quay-perpetual-stream/milestones/M<NN>`.
# Accepts either a bare number ("176") or an "M"-prefixed id ("M176", "M176-some-slug") — the
# leading "M" and any trailing "-slug" are stripped before comparison. Does NOT check the
# directory exists on disk; callers that need existence should test the echoed path themselves
# (legacy milestones before this rule was pinned may use a slugged directory name, e.g.
# `M45-cryst-d1-doc-management`, not a bare `M45` — callers needing those must probe separately).
#
# Usage: root=$(gate_resolve_milestone_root "$MILESTONE")
gate_resolve_milestone_root() {
  local _ms="${1:?milestone id required (e.g. \"176\" or \"M176\")}"
  _ms="${_ms#M}"        # strip optional leading "M"
  _ms="${_ms%%-*}"      # strip optional trailing "-slug"
  local _num=$((10#$_ms))  # force base-10 (avoid octal misparse on zero-padded ids)
  if [ "$_num" -ge 130 ]; then
    echo "milestones/M${_num}"
  else
    echo "experiments/quay-perpetual-stream/milestones/M${_num}"
  fi
}

# ── gate_emit_pass / gate_emit_fail ─────────────────────────────────────────────────────────────────
# Standardized PASS / FAIL output lines.
gate_emit_pass() { echo "PASS: $*"; }
gate_emit_fail() { echo "FAIL: $*"; }

# ── tool_help ───────────────────────────────────────────────────────────────────────────────────────
# The UNIFORM --help contract (gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools,
# AC2 least-common-denominator mechanism). Every .sh tool routes `--help|-h` through this function.
#   * FIRST output line starts with 用法 — the Contract measure
#     (`bash "$f" --help 2>&1 | head -1 | grep -ci 'usage\|用法'`) reads ONLY the first line, so the
#     用法 token MUST be first for the tool to count as help-consistent.
#   * then the script's own header comment (its detailed usage), shebang line skipped.
#   * exit 0, NO business side effects — the AC3 load-bearing negative control: supervisor-deliver.sh
#     --help must never attempt a delivery; the invariant: capability-catalog.sh --help must not
#     run the catalog.
# Usage: tool_help <script-path>
tool_help() {
  local _s="${1:?script path required}" _b
  _b="$(basename "$_s")"
  printf '用法: bash %s [参数…] — 详见下方脚本头部用法注释（--help|-h 仅打印用法，无副作用，退出 0）\n' "$_b"
  if [ -f "$_s" ]; then
    awk 'NR<=120 && /^#/ { sub(/^# ?/, ""); if ($0 !~ /^!/) print }' "$_s" 2>/dev/null || true
  fi
  return 0
}
