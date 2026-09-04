#!/usr/bin/env bash
# checker-mutation-check.sh — mutation-test the CHECKERS themselves (the L_S instrument,
# tasks/gap-checkers-have-never-been-shown-to-fail, spec AC1 priority).
#
# NOT a mutation test of product code. The object being mutated is the guard: for every
# registered checker we deliberately break what it claims to check and assert the checker
# goes RED; restore; assert GREEN. A checker that never goes red under a defect it claims
# to catch is indistinguishable from a checker that always returns "pass" — exactly the
# #6 instance (rename negative control whose zero-dependency probe could not fail) and
# #10 instance (/live acceptance that only tested the data-missing direction) that are
# the day's real failures this task exists to make impossible.
#
# THE MANIFEST IS NEVER HAND-WRITTEN (AC1b). Registered checkers are parsed out of
# scripts/test.sh's run_static_checks / run_doc_checks functions, runner-static-gate.ts's
# run_operational_checks, and the CI workflows (.github/workflows/*.yml):
#   - run_static_checks / run_operational_checks: every invocation of `plugin/scripts/<name>.(sh|ts)`
#   - run_doc_checks: the doc-class checkers (moved out of the suite under AC51, still manifest-covered)
#   - CI: every `node --experimental-strip-types scripts/<name>.ts` gate step
# A checker added to either surface appears in the manifest automatically; if it has no
# mutation case in plugin/scripts/checker-mutation-cases/ it is reported UNCOVERED and the
# --check gate fails — a new checker with no mutation case can never silently slip through.
#
# THE MECHANISM MUTATES ITSELF TOO (AC1c/AC4): `--selftest` breaks each of the mechanism's
# own core behaviors (parser returns nothing / case loop skipped / RED inverted) and asserts
# the gate FAILS. A mutation-testing harness that cannot fail when broken is the exact thing
# it exists to catch.
#
# Usage:
#   checker-mutation-check.sh --list               # text manifest (names + coverage + totals)
#   checker-mutation-check.sh --list --json        # machine-readable manifest
#   checker-mutation-check.sh --run [--json]       # run every mutation case + the AC5 regressions
#   checker-mutation-check.sh --check              # fail-closed gate (wired into run_static_checks)
#   checker-mutation-check.sh --selftest           # meta-mutation self-check (AC4)
#   checker-mutation-check.sh --repo-root <dir>    # parse THIS root's test.sh/workflows (tests only)
#   checker-mutation-check.sh --meta-inject <mode> # test-only breakage: empty-manifest|skip-cases|invert-red
#
# Case-script contract (plugin/scripts/checker-mutation-cases/<name>.sh):
#   bash <case>.sh <workdir>
#   Exit 0 = mutation behaved (baseline GREEN → inject → RED → restore → GREEN all proven)
#   Exit 3 = STAYED-GREEN (defect present, checker still exited 0) → counts as mutations_that_stayed_green
#   Exit 4 = ALWAYS-RED (restored object, checker still exited non-zero)
#   Exit 2 = infrastructure error (case could not run)
#
# Exit codes: 0 = all mutation cases behaved; 1 = violations found (stayed-green / always-red /
# uncovered checker / empty manifest); 2 = usage/environment error.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -u

# ── locations ──────────────────────────────────────────────────────────────────────────────────────
_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${_script_dir}/../.." && pwd)"
CASES_DIR="${repo_root}/plugin/scripts/checker-mutation-cases"
TEST_SH="${repo_root}/scripts/test.sh"
STATIC_GATE="${repo_root}/plugin/scripts/runner-static-gate.ts"
WORKFLOWS_GLOB="${repo_root}/.github/workflows/*.yml"

# ── arg defaults ───────────────────────────────────────────────────────────────────────────────────
meta_inject=""

# ── manifest parsing (AC1: run_static_checks + run_operational_checks + run_doc_checks + CI, never hand-written) ──

# Parse the run_static_checks() and run_operational_checks() bodies (both in runner-static-gate.ts,
# gap-ac128-hub-split-harness-concerns) AND run_doc_checks() (still in scripts/test.sh) for
# plugin/scripts/<name>.(sh|ts). The doc-class checkers MOVED to run_doc_checks under AC51
# (gap-ac51-assertion-surface-split — they now run at pre-commit, not in the full suite) and the
# OPERATIONAL-class (runtime-state) checkers MOVED to run_operational_checks under the 2026-09-02
# passive-machine ruling (run only via `scripts/test.sh --static-checks-operational` on the ACTIVE
# host, NOT the full-suite gate) — but BOTH families' mutation cases MUST stay in this manifest —
# the L_S instrument is not weakened by either split. The awk is anchored per function name (from
# the `run_static_checks() {` / `run_operational_checks() {` / `run_doc_checks() {` line to its own
# closing `}`).
list_run_static_checks_checkers() {
  local body=""
  if [ -f "$STATIC_GATE" ]; then
    body="$(awk '/^run_static_checks\(\)/{f=1;next} f && /^}/{f=0} f' "$STATIC_GATE")"
    body="${body}
$(awk '/^run_operational_checks\(\)/{f=1;next} f && /^}/{f=0} f' "$STATIC_GATE")"
  fi
  if [ -f "$TEST_SH" ]; then
    body="${body}
$(awk '/^run_doc_checks\(\)/{f=1;next} f && /^}/{f=0} f' "$TEST_SH")"
  fi
  printf '%s\n' "$body" \
    | grep -oE '\$\{repo_root\}/plugin/scripts/[A-Za-z0-9_.-]+\.(sh|ts)' \
    | sed -E 's#.*/plugin/scripts/##; s/\.(sh|ts)$//' \
    | sort -u
}

# Parse CI workflow run: steps for `node --experimental-strip-types scripts/<name>.ts` gates.
list_ci_checkers() {
  grep -hoE 'node (--[a-z-]+ )*scripts/[A-Za-z0-9_.-]+\.ts' $WORKFLOWS_GLOB 2>/dev/null \
    | sed -E 's#.*scripts/##; s/\.ts$//' \
    | sort -u
}

# The full registered manifest: union of both sources, deduped.
all_registered_checkers() {
  (list_run_static_checks_checkers; list_ci_checkers) | sort -u
}

# source of a checker: run_static_checks / ci / both.
source_of() {
  local name="$1" src=""
  if list_run_static_checks_checkers | grep -qx "$name"; then
    src="run_static_checks"
  fi
  if list_ci_checkers | grep -qx "$name"; then
    src="${src:+${src}+ci}ci"
  fi
  echo "${src:-unknown}"
}

# has a mutation case file?
has_case() {
  [ -f "${CASES_DIR}/$1.sh" ]
}

# ── helpers ────────────────────────────────────────────────────────────────────────────────────────

die_usage() {
  echo "Usage: checker-mutation-check.sh --list [--json] | --run [--json] | --check | --selftest [--repo-root <dir>] [--meta-inject <mode>]" >&2
  exit 2
}

now_ms() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    local t="$EPOCHREALTIME" sec frac
    sec="${t%.*}"
    frac="${t#*.}"
    printf '%s%s' "$sec" "${frac:0:3}"
  else
    date +%s000
  fi
}

registered_count() {
  all_registered_checkers | wc -l | tr -d ' '
}

covered_count() {
  local n c=0
  while IFS= read -r n; do
    has_case "$n" && c=$((c + 1))
  done < <(all_registered_checkers)
  echo "$c"
}

# ── --list ─────────────────────────────────────────────────────────────────────────────────────────

list_plain() {
  local name total covered
  total="$(registered_count)"
  covered="$(covered_count)"
  echo "checkers_total: ${total} (parsed from run_static_checks + run_operational_checks + run_doc_checks + CI, never hand-written)"
  echo "checkers_with_mutation: ${covered}"
  if [ "$covered" -eq "$total" ]; then
    echo "uncovered: none"
  else
    echo -n "uncovered: "
    while IFS= read -r name; do has_case "$name" || printf '%s ' "$name"; done < <(all_registered_checkers)
    echo ""
  fi
  echo ""
  printf '%-40s %-8s %s\n' "checker" "covered" "source"
  while IFS= read -r name; do
    local cov
    if has_case "$name"; then cov="yes"; else cov="NO"; fi
    printf '%-40s %-8s %s\n' "$name" "$cov" "$(source_of "$name")"
  done < <(all_registered_checkers)
}

list_json() {
  local first=1 entry
  printf '{"checkers_total":%d,"checkers_with_mutation":%d,"uncovered":[' "$(registered_count)" "$(covered_count)"
  while IFS= read -r name; do
    if ! has_case "$name"; then
      [ "$first" -eq 1 ] || printf ', '
      printf '"%s"' "$name"
      first=0
    fi
  done < <(all_registered_checkers)
  printf '],"checkers":['
  first=1
  while IFS= read -r name; do
    [ "$first" -eq 1 ] || printf ','
    if has_case "$name"; then entry="true"; else entry="false"; fi
    printf '{"name":"%s","source":"%s","covered":%s}' "$name" "$(source_of "$name")" "$entry"
    first=0
  done < <(all_registered_checkers)
  printf ']}\n'
}

# ── --run / --check ────────────────────────────────────────────────────────────────────────────────

run_one_case() {
  local name="$1" workdir="$2" log exit_code
  log="$(mktemp)"
  bash "${CASES_DIR}/${name}.sh" "$workdir" >"$log" 2>&1
  exit_code=$?
  if [ "$_json_mode" != "1" ]; then
    cat "$log"
  fi
  rm -f "$log"
  return "$exit_code"
}

run_cases() {
  _json_mode="$1"
  _stayed_green=0; _always_red=0; _errors=0; _uncovered_count=0; _regression_green=0
  _stayed_names=(); _always_names=(); _error_names=(); _uncovered_names=()
  _results_json=""
  local checkers=() name case_list=() reg
  while IFS= read -r name; do checkers+=("$name"); done < <(all_registered_checkers)
  for name in "${checkers[@]}"; do
    if has_case "$name"; then
      case_list+=("$name")
    else
      _uncovered_count=$((_uncovered_count + 1)); _uncovered_names+=("$name")
    fi
  done
  for reg in regression-rename-negative-control-probe regression-live-telemetry-empty-activity; do
    if has_case "$reg"; then
      case_list+=("$reg")
    else
      _uncovered_count=$((_uncovered_count + 1)); _uncovered_names+=("$reg")
    fi
  done
  # Any --meta-inject short-circuits the case loop: the injection IS the broken state being
  # demonstrated (parser empty / loop skipped / detection inverted), so the gate must fail
  # without paying the cost of a real run. The per-case behavior is tested by the plain run.
  if [ -n "${meta_inject}" ]; then
    case_list=()
  fi

  local start_ms end_ms
  start_ms="$(now_ms)"
  for name in "${case_list[@]}"; do
    local workdir exit_code res
    workdir="$(mktemp -d "${TMPDIR:-/tmp}/cmc-case-XXXXXX")"
    run_one_case "$name" "$workdir"
    exit_code=$?
    rm -rf "$workdir"
    case "$exit_code" in
      0) res="pass"; case "$name" in regression-*) _regression_green=$((_regression_green + 1));; esac ;;
      3) res="stayed-green"; _stayed_green=$((_stayed_green + 1)); _stayed_names+=("$name") ;;
      4) res="always-red"; _always_red=$((_always_red + 1)); _always_names+=("$name") ;;
      *) res="error"; _errors=$((_errors + 1)); _error_names+=("$name") ;;
    esac
    if [ "$_json_mode" = "1" ]; then
      _results_json="${_results_json}${_results_json:+,}\"${name}\":\"${res}\""
    else
      echo "MUTATION $name: $res"
    fi
  done
  end_ms="$(now_ms)"
  _run_duration_ms=$((end_ms - start_ms))
  if [ "$_json_mode" = "1" ]; then
    _results_json="{${_results_json}}"
  fi

  local overall=0
  if [ "$_stayed_green" -gt 0 ] || [ "$_always_red" -gt 0 ] || [ "$_errors" -gt 0 ] || [ "$_uncovered_count" -gt 0 ]; then
    overall=1
  fi
  if [ "${#checkers[@]}" -eq 0 ]; then
    echo "checker-mutation-check: ERROR — manifest is EMPTY (parser found no checkers; is scripts/test.sh / .github/workflows present and parseable?)" >&2
    overall=1
  fi
  if [ "${meta_inject}" = "empty-manifest" ]; then
    echo "checker-mutation-check: [meta-inject empty-manifest] manifest deliberately returned empty — gate must fail" >&2
    overall=1
  fi
  if [ "${meta_inject}" = "skip-cases" ]; then
    echo "checker-mutation-check: [meta-inject skip-cases] case loop deliberately skipped — zero mutations ran, gate must fail" >&2
    overall=1
  fi
  if [ "${meta_inject}" = "invert-red" ]; then
    echo "checker-mutation-check: [meta-inject invert-red] every RED assertion inverted — gate must fail" >&2
    overall=1
  fi
  return "$overall"
}

run_plain() {
  run_cases 0
  local overall=$?
  echo ""
  echo "checkers_total: $(registered_count)"
  echo "checkers_with_mutation: $(covered_count)"
  echo "mutations_that_stayed_green: ${_stayed_green}"
  if [ "${#_stayed_names[@]}" -gt 0 ]; then
    echo "stayed-green (defect present, checker still green) — THE FINDINGS:"
    printf '  - %s\n' "${_stayed_names[@]}"
  fi
  echo "mutations_that_always_red: ${_always_red}"
  if [ "${#_always_names[@]}" -gt 0 ]; then
    echo "always-red (restore still red):"
    printf '  - %s\n' "${_always_names[@]}"
  fi
  echo "uncovered (registered checker with no mutation case): ${_uncovered_count}"
  if [ "${#_uncovered_names[@]}" -gt 0 ]; then
    printf '  - %s\n' "${_uncovered_names[@]}"
  fi
  echo "errors: ${_errors}"
  echo "duration_ms: ${_run_duration_ms}"
  if [ "$overall" -ne 0 ]; then
    echo "RESULT: FAIL — a checker stayed green under a defect it should catch, or the manifest is incomplete/broken."
  else
    echo "RESULT: PASS — every registered checker went RED under its injected defect and GREEN on restore; mutations_that_stayed_green = 0."
  fi
  return "$overall"
}

# join_json_names <name...> — emit a JSON string array. Safe for zero args (emits []).
join_json_names() {
  local first=1 n
  if [ "$#" -gt 0 ]; then
    for n in "$@"; do
      [ "$first" -eq 1 ] || printf ', '
      printf '"%s"' "$n"
      first=0
    done
  fi
}

run_json() {
  run_cases 1
  local overall=$?
  printf '{"checkers_total":%d,"checkers_with_mutation":%d,"mutations_that_stayed_green":%d,"stayed_green":[%s],"mutations_that_always_red":%d,"always_red":[%s],"errors":%d,"error_names":[%s],"uncovered":[%s],"results":%s,"duration_ms":%d}\n' \
    "$(registered_count)" "$(covered_count)" \
    "$_stayed_green" "$(join_json_names ${_stayed_names[@]+"${_stayed_names[@]}"})" \
    "$_always_red" "$(join_json_names ${_always_names[@]+"${_always_names[@]}"})" \
    "$_errors" "$(join_json_names ${_error_names[@]+"${_error_names[@]}"})" \
    "$(join_json_names ${_uncovered_names[@]+"${_uncovered_names[@]}"})" \
    "$_results_json" \
    "$_run_duration_ms"
  return "$overall"
}

# ── --selftest (AC4 meta-mutation: break the mechanism, it must fail) ─────────────────────────────

run_selftest() {
  local fail=0
  echo "checker-mutation-check --selftest (AC4: breaking the mechanism must fail)"
  # 1. empty manifest → gate must fail
  if bash "${BASH_SOURCE[0]}" --repo-root "$repo_root" --check --meta-inject empty-manifest >/dev/null 2>&1; then
    echo "FAIL: --meta-inject empty-manifest did NOT fail the gate" >&2
    fail=1
  else
    echo "PASS: empty-manifest injection fails the gate"
  fi
  # 2. skip-cases → gate must fail
  if bash "${BASH_SOURCE[0]}" --repo-root "$repo_root" --check --meta-inject skip-cases >/dev/null 2>&1; then
    echo "FAIL: --meta-inject skip-cases did NOT fail the gate" >&2
    fail=1
  else
    echo "PASS: skip-cases injection fails the gate"
  fi
  # 3. invert-red → gate must fail
  if bash "${BASH_SOURCE[0]}" --repo-root "$repo_root" --check --meta-inject invert-red >/dev/null 2>&1; then
    echo "FAIL: --meta-inject invert-red did NOT fail the gate" >&2
    fail=1
  else
    echo "PASS: invert-red injection fails the gate"
  fi
  echo "checker-mutation-check --selftest: $([ "$fail" -eq 0 ] && echo ALL PASS || echo FAILED)"
  return "$fail"
}

# ── argument dispatch ──────────────────────────────────────────────────────────────────────────────

cmd=""
json=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --list) cmd="list" ;;
    --run) cmd="run" ;;
    --check) cmd="check" ;;
    --selftest) cmd="selftest" ;;
    --json) json=1 ;;
    --repo-root) shift; repo_root="$1"; CASES_DIR="${repo_root}/plugin/scripts/checker-mutation-cases"; TEST_SH="${repo_root}/scripts/test.sh"; STATIC_GATE="${repo_root}/plugin/scripts/runner-static-gate.ts"; WORKFLOWS_GLOB="${repo_root}/.github/workflows/*.yml" ;;
    --meta-inject) shift; meta_inject="$1" ;;
    -*) die_usage ;;
    *) die_usage ;;
  esac
  shift
done

case "$cmd" in
  list)
    if [ "$json" -eq 1 ]; then list_json; else list_plain; fi
    ;;
  run|check)
    if [ "$json" -eq 1 ]; then
      run_json
    else
      run_plain
    fi
    ;;
  selftest)
    run_selftest
    ;;
  *)
    die_usage
    ;;
esac
