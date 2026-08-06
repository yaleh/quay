#!/usr/bin/env bash
# checker-cost-lib.sh — the criterion-cost RECORDING wrapper for the bash static-check path.
# Task: gap-no-criterion-records-its-own-cost-checker-cost-jsonl
#
# Source this file (after repo_root is known), then wrap a criterion execution with:
#   run_checker <name> <cmd...>
# e.g. run_checker "it0-split-or-commit" bash "${repo_root}/plugin/scripts/it0-split-or-commit-check.sh" "${repo_root}"
#
# run_checker TIMES the command, appends ONE `{name, ms, n, load, at}` line to
# .quay/checker-cost.jsonl (PURE APPEND, ZERO JUDGMENT — no threshold, no flag), and returns the
# command's exit code (so a failing checker still aborts the suite under `set -e`, unchanged).
#
# The JSONL shape is the SAME as plugin/scripts/checker-cost.ts + the inlined gate recorder in
# packages/quay/src/gate/engine.ts — pinned by plugin/test/checker-cost.test.mjs.
#
# Env seams:
#   CHECKER_COST_FILE  — override the .quay/checker-cost.jsonl path (hermetic tests).
#   CHECKER_COST_N     — override the recorded n (default 1; ready-pool-check self-records real n).
#   CHECKER_COST_LOAD_OVERRIDE — record this load instead of reading /proc/loadavg (AC2 fixture).

# ── timestamp helpers (nanosecond where available, seconds fallback) ───────────────────────────────
_checker_cost_now_ns() {
  date +%s%N 2>/dev/null || date +%s
}
_checker_cost_ms_between() {
  local _s="$1" _e="$2"
  # ns timestamps are 16 digits; sec timestamps are 10.
  if [ "${#_s}" -ge 13 ] && [ "${#_e}" -ge 13 ]; then
    echo "$(( (_e - _s) / 1000000 ))"
  else
    echo "$(( (_e - _s) * 1000 ))"
  fi
}

# ── append one cost row (no timing — the caller already measured ms) ────────────────────────────────
checker_cost_append() {
  local _name="$1" _ms="$2" _n="${3:-1}"
  local _load _file _at
  if [ -n "${CHECKER_COST_LOAD_OVERRIDE:-}" ]; then
    _load="${CHECKER_COST_LOAD_OVERRIDE}"
  else
    _load="$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0)"
  fi
  _file="${CHECKER_COST_FILE:-${repo_root:-.}/.quay/checker-cost.jsonl}"
  _at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "$(dirname "$_file")"
  # names are [a-z0-9-]+ identifiers — safe to embed directly (documented constraint).
  printf '{"name":"%s","ms":%s,"n":%s,"load":%s,"at":"%s"}\n' \
    "$_name" "$_ms" "$_n" "$_load" "$_at" >> "$_file"
}

# ── run a criterion, time it, record its cost, return its exit code ────────────────────────────────
# set -e safe: the `if "$@"` form exempts the command from errexit, so a failing checker is
# recorded and the FAILURE is propagated via the return code (caller's set -e aborts, unchanged).
run_checker() {
  local _name="$1"; shift
  local _start _end _ms _rc=0
  _start="$(_checker_cost_now_ns)"
  if "$@"; then
    _rc=0
  else
    _rc=$?
  fi
  _end="$(_checker_cost_now_ns)"
  _ms="$(_checker_cost_ms_between "$_start" "$_end")"
  checker_cost_append "$_name" "$_ms" "${CHECKER_COST_N:-1}"
  return "$_rc"
}
