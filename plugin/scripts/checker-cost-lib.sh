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

# ── NOT-EVALUATED third state (gap-not-evaluated-harness-third-state) ────────────────────────────────
# A criterion that CANNOT evaluate its input must not be conflated with either a PASS (exit 0) or a
# RED (fail-closed) — hard rule 3b ("读不懂输入时不得返回与合格同形的值"). The checker convention is
# exit 3 = NOT-EVALUATED (exit 0 = PASS, 1 = RED, 2 = usage/env error). run_checker recognizes exit 3
# as a THIRD state: it is NOT fail-closed (never aborts the suite, never emits STATIC_CHECK_FAILED) and
# NOT a plain pass (surfaced as `STATIC_CHECK_NOT_EVALUATED: <name>`, counted separately).
RUN_CHECKER_EXIT_NOT_EVALUATED=3

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
# The timed+recorded core is _run_checker_one; run_checker dispatches on RUN_CHECKER_PARALLEL.
_run_checker_one() {
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

# ── parallel-mode support (gap-run-static-checks-zero-concurrency-can-parallelize) ──────────────────
# run_static_checks launches ~20 independent read-only checkers; sequential execution was structural
# zero-concurrency (no &/wait/xargs -P). When RUN_CHECKER_PARALLEL=1, run_checker backgrounds the
# timed+recorded run (concurrency bounded to STATIC_CHECK_CONCURRENCY — default nproc, "读 nproc";
# set the var for a fixed N) and returns immediately; the caller MUST call run_checker_parallel_wait
# before continuing. The wait collects every checker's exit code from a per-run results file and
# FAILS CLOSED if any failed (AC3 — a failing checker is never masked by its siblings' output, and
# its name is reported), while every checker's cost row is still appended (AC4 — the backgrounded
# run completes checker_cost_append before the wait observes it). The scoped tier leaves
# RUN_CHECKER_PARALLEL unset, so its single evals run synchronously — unchanged.

_run_par_results_file=""
_run_par_launched=0
_run_par_max=0
_run_par_failures=()
_run_par_not_evaluated=()
_run_par_first_rc=0

_run_par_done_count() {
  if [ -n "$_run_par_results_file" ] && [ -f "$_run_par_results_file" ]; then
    wc -l < "$_run_par_results_file" | tr -d ' '
  else
    echo 0
  fi
}

# Block while the pool is at capacity (running ≥ _run_par_max). `wait -n` releases a slot the
# moment ANY backgrounded checker exits; attribution is done later from the results file, so the
# identity of the just-finished job is irrelevant here.
_run_par_wait_slot() {
  while [ "$((_run_par_launched - $(_run_par_done_count)))" -ge "$_run_par_max" ]; do
    wait -n 2>/dev/null || true
  done
}

run_checker() {
  local _name="$1"; shift
  if [ "${RUN_CHECKER_PARALLEL:-0}" = "1" ]; then
    if [ "$_run_par_max" -lt 1 ]; then
      _run_par_max="${STATIC_CHECK_CONCURRENCY:-}"
      if [ -z "$_run_par_max" ]; then _run_par_max="$(nproc 2>/dev/null || echo 4)"; fi
    fi
    if [ -z "$_run_par_results_file" ]; then
      _run_par_results_file="$(mktemp "${TMPDIR:-/tmp}/checker-cost-results-XXXXXX")"
    fi
    _run_par_wait_slot
    _run_par_launched=$((_run_par_launched + 1))
    (
      _rc=0
      _run_checker_one "$_name" "$@" || _rc=$?
      # `|` never appears in a checker name ([A-Za-z0-9_.-]+ documented constraint) — safe split.
      printf '%s|%s\n' "$_name" "$_rc" >> "$_run_par_results_file"
    ) &
    return 0
  fi
  # Synchronous (scoped tier / doc checks). NOT-EVALUATED (exit 3) must not abort the suite under
  # `set -e`: surface it on stderr (counted separately, never conflated with a pass) and return 0 —
  # a RED (1) or usage error (2) still propagates as before. The `if` form keeps the `$?` capture off
  # a pipe-bearing line (instrument-failure-check FAMILY-3 flags a `$?` read after a pipe character).
  local _rc=0
  if _run_checker_one "$_name" "$@"; then
    _rc=0
  else
    _rc=$?
  fi
  if [ "$_rc" -eq "$RUN_CHECKER_EXIT_NOT_EVALUATED" ]; then
    echo "STATIC_CHECK_NOT_EVALUATED: ${_name}" >&2
    return 0
  fi
  # FAIL-CLOSED MACHINE LINE (gap-scoped-static-check-red-no-fail-machine-line): the parallel wait
  # (run_checker_parallel_wait) already emits `STATIC_CHECK_FAILED: <name> exit=<rc>` per failing
  # checker, but the synchronous scoped tier left a RED (1) / usage error (2) with NO machine line —
  # a fail-closed checker's identity vanished from the carrier (hard rule 3b/4b/9), so worker-driver's
  # extractFailureSummary fell back to a benign preamble ("copied N file(s)" + a module warning). Emit
  # the SAME machine line here so a scoped-gate red carries the checker name + exit code. NOT-EVALUATED
  # (3) already emitted its distinct STATIC_CHECK_NOT_EVALUATED line above; exit 0 emits nothing.
  if [ "$_rc" -ne 0 ]; then
    echo "STATIC_CHECK_FAILED: ${_name} exit=${_rc}" >&2
  fi
  return "$_rc"
}

# Wait for all launched checkers, report any failures, fail closed (AC3). Every exit is recorded
# (AC4 — each backgrounded _run_checker_one appended before the wait observed it). Returns the FIRST
# failing checker's exit code (0 if all clean) and resets the pool state for a later call.
#
# FAIL-CLOSED MACHINE LINE (gap-static-check-red-failures-capture-only-task-contract-shape): the
# human-readable summary (`static checks FAILED (fail-closed): <names>(exit=<rc>)`) is what a human
# reads, but full-suite-runner's failures[] capture cannot regex the summary shape (it only knew the
# task-contract VIOLATION/summary/ratchet forms — a fail-closed checker's 真因 got ZERO entries into
# the round record). Emit ONE machine-parseable line per failing checker on stderr:
#   STATIC_CHECK_FAILED: <name> exit=<rc>
# The runner's isStaticCheckFailureLine + extractFailClosedChecker parse this into failures[] (the
# 真因: fail-closed checker name + exit code), separated from the VIOLATION detail lines (AC2).
run_checker_parallel_wait() {
  while [ "$((_run_par_launched - $(_run_par_done_count)))" -gt 0 ]; do
    wait -n 2>/dev/null || true
  done
  local _name _rc _fail=0 _ret=0
  if [ -n "$_run_par_results_file" ] && [ -f "$_run_par_results_file" ]; then
    while IFS='|' read -r _name _rc; do
      if [ -z "$_rc" ] || [ "$_rc" -eq 0 ]; then
        continue
      fi
      if [ "$_rc" -eq "$RUN_CHECKER_EXIT_NOT_EVALUATED" ]; then
        # NOT-EVALUATED (exit 3) — a THIRD state, neither RED nor PASS (gap-not-evaluated-harness-
        # third-state). Counted separately: surfaced as a distinct stderr line (never
        # STATIC_CHECK_FAILED, never a plain pass), never fail-closed.
        echo "STATIC_CHECK_NOT_EVALUATED: ${_name}" >&2
        _run_par_not_evaluated+=("${_name}")
        continue
      fi
      _fail=1
      [ "$_run_par_first_rc" -eq 0 ] && _run_par_first_rc="$_rc"
      _run_par_failures+=("${_name}|${_rc}")
    done < "$_run_par_results_file"
    rm -f "$_run_par_results_file"
    _run_par_results_file=""
  fi
  _ret="$_run_par_first_rc"
  if [ "$_fail" -ne 0 ]; then
    local _msg="checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): "
    local _entry _parsed_name _parsed_rc _first=1
    for _entry in "${_run_par_failures[@]}"; do
      _parsed_name="${_entry%%|*}"
      _parsed_rc="${_entry##*|}"
      echo "STATIC_CHECK_FAILED: ${_parsed_name} exit=${_parsed_rc}" >&2
      if [ "$_first" -eq 1 ]; then
        _msg="${_msg}${_parsed_name}(exit=${_parsed_rc})"
        _first=0
      else
        _msg="${_msg} ${_parsed_name}(exit=${_parsed_rc})"
      fi
    done
    _run_par_failures=()
    _run_par_not_evaluated=()
    _run_par_first_rc=0
    _run_par_launched=0
    RUN_CHECKER_PARALLEL=0
    echo "$_msg" >&2
    return "$_ret"
  fi
  if [ "${#_run_par_not_evaluated[@]}" -gt 0 ]; then
    echo "checker-cost-lib: ${#_run_par_not_evaluated[@]} checker(s) NOT-EVALUATED (third state, not a failure): ${_run_par_not_evaluated[*]}" >&2
  fi
  _run_par_failures=()
  _run_par_not_evaluated=()
  _run_par_first_rc=0
  _run_par_launched=0
  RUN_CHECKER_PARALLEL=0
  return 0
}
