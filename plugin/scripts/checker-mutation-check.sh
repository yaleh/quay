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
#   checker-mutation-check.sh --check --only <csv> # run ONLY the named checkers' cases (narrowed cost)
#   checker-mutation-check.sh --check-changed      # change-tier companion: run the cases of only the
#                                                  # checkers THIS delta touches (see below)
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
#
# ── --check-changed: the CHANGE-TIER COMPANION (gap-checker-mutation-check-has-no-change-tier-companion) ──
# The full-tier registration above is the whole-store兜底: it mutation-tests ALL registered checkers
# in one ~19s-median (55.6s median over the last 7 recorded) pass, and it is DEFERRED out of scoped
# runs — so the cost of a stale mutation case falls on an UNRELATED task's fan-in, but the task that
# actually edited the checker never pays. Measured (`.quay/verification-round.jsonl`,
# `STATIC_CHECK_FAILED: checker-mutation-check`): 8 fan-in静态闸 failures, last 2026-09-13T04:41:32Z.
# This mode is the既定解法 this repo already used for the same defect class
# (`quay-init-closure-ratchet-stale`, gap-quay-init-closure-ratchet-manual-reanchor-recurs: its
# companion drove that checker's fan-in reds 35 → 0 after 2026-09-06): narrow the judgment to THIS
# delta so it fires at the CHANGER's own scoped gate, while the full-tier check stays byte-unchanged
# as the whole-store兜底 (delay ≠ drop, same design as gap-scoped-runs-pay-full-static-check-overhead).
#
# Judgment domain = the checkers THIS delta touches, derived from git (NOT the whole 71):
#   base = first resolvable of develop / origin/develop / master / origin/master
#   delta = `git diff --name-only base...HEAD` ∪ `git diff --name-only HEAD` ∪ untracked
#   carriers = delta paths that name a REGISTERED checker, either
#              `plugin/scripts/<name>.{sh,ts}` or `plugin/scripts/checker-mutation-cases/<name>.sh`
#              (the mutation case IS a checker carrier: editing it changes what the checker is
#              proven to catch). Plus: if the MANIFEST SOURCE itself changed
#              (`plugin/scripts/runner-static-gate.ts` / `scripts/test.sh` / `.github/workflows/*.yml`)
#              the registered SET may have grown ⇒ the whole-manifest覆盖度 (uncovered) dimension is
#              re-verified here too — cheap, `--list`-based, no case execution.
#   exit 0 = every touched checker's case behaved (and, when the manifest source moved, uncovered=0)
#   exit 1 = a touched checker's case stayed-green / always-red / errored, OR a registered checker
#            has no mutation case after a manifest-source change
#
# NOT-EVALUATED is reported as an explicit `NOT-EVALUATED` LINE with exit 0, NOT as exit 3 — a
# deliberate deviation from this script's own exit-3 convention: the SCOPED runner
# (`scripts/test.sh:run_scoped_static_checks_sel`) evaluates each selected checker command with a raw
# `eval` under `set -euo pipefail`, so any non-zero — including 3 — ABORTS an innocent task's scoped
# run. A delta whose Touches name a checker but whose actual git delta does not contain it (Touches
# ⊋ delta is normal) must not abort; it must say so. Same scoped-safe convention as
# `suite-bucket-drift-check` ("缓存缺失 ⇒ NOT-EVALUATED (exit 0 但可区分输出, 硬规则 3b)"). The
# output vocabulary stays three-valued (PASS / RED / NOT-EVALUATED), so hard rule 3b holds: the
# not-evaluated state is visible and never同形于 pass.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -u

# ── locations ──────────────────────────────────────────────────────────────────────────────────────
_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "${_script_dir}/../.." && pwd -P)"
CASES_DIR="${repo_root}/plugin/scripts/checker-mutation-cases"
TEST_SH="${repo_root}/scripts/test.sh"
STATIC_GATE="${repo_root}/plugin/scripts/runner-static-gate.ts"
WORKFLOWS_GLOB="${repo_root}/.github/workflows/*.yml"

# ── arg defaults ───────────────────────────────────────────────────────────────────────────────────
meta_inject=""
# --only <csv>: restrict the case run to these registered checkers (narrowed cost — the change-tier
# companion's narrowing primitive; `--check-changed` fills it from the delta). Empty = whole manifest.
_only_csv=""

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

# _in_list <needle> <haystack...> — exact membership. Bash-native on purpose: `grep -q` would exit
# early and (under a caller's `pipefail`) turn a TRUE predicate into a 141 pipeline failure
# (memory: pipefail-plus-grep-q-makes-predicates-read-false-when-true).
_in_list() {
  local _needle="$1"; shift
  local _item
  for _item in ${1+"$@"}; do
    [ "$_item" = "$_needle" ] && return 0
  done
  return 1
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

# ── bounded-parallel case pool ─────────────────────────────────────────────────────────────────────
# run_cases() backgrounds each case, so results MUST travel through a FILE: a backgrounded subshell
# is a separate process and every assignment it makes to a parent variable is DISCARDED. That is why
# backgrounding the per-case call WITHOUT a results channel is a FAIL-OPEN — `$?` then reads the
# status of the `&` itself (always 0), every counter and every `_results_json` write is lost, and the gate prints
# `RESULT: PASS` unconditionally: a checker that can never redden, which is the exact defect this
# whole script exists to catch. scripts/test.sh:291-297 already records this shape for the doc-check
# tier ("backgrounded checkers would return 0 immediately and mask a doc-check failure").
# The shape below is copied from checker-cost-lib.sh's run_checker parallel branch (:110-158) rather
# than reinvented (hard rule 1) — exit codes come back through a results file, attribution is done
# AFTER the reap, and the pool cap is host-derived.

_case_par_max=""
_case_par_results_file=""
_case_par_launched=0

_case_par_done_count() {
  if [ -n "$_case_par_results_file" ] && [ -f "$_case_par_results_file" ]; then
    wc -l < "$_case_par_results_file" | tr -d ' '
  else
    echo 0
  fi
}

# Host-derived pool size — NEVER a literal: a number that merely happens to equal "no limit" on
# today's host is a real cap on the next one, silently (hard rule 4 推论二; scripts/test.sh:453-455
# says the same). CHECKER_MUTATION_PARALLEL overrides; STATIC_CHECK_CONCURRENCY is the existing
# sibling knob and is reused before falling back to nproc. A non-numeric / zero value degrades to
# the HOST READ, never to "no throttle" — a garbage value must not silently launch all 82 at once.
_case_par_resolve_max() {
  _case_par_max="${CHECKER_MUTATION_PARALLEL:-${STATIC_CHECK_CONCURRENCY:-}}"
  case "$_case_par_max" in
    ''|*[!0-9]*) _case_par_max="$(nproc 2>/dev/null || echo 4)" ;;
  esac
  [ "$_case_par_max" -ge 1 ] 2>/dev/null || _case_par_max=1
}

# Block while the pool is at capacity: `wait -n` frees a slot the moment ANY backgrounded case
# exits, and which job that was is irrelevant (attribution happens after the final `wait`, from the
# results file). The `jobs -rp` check is a safety valve: a subshell killed before it appended its
# line would leave the file-derived count permanently short of _case_par_launched and spin this loop
# forever — with no running children the pool cannot be at capacity.
_case_par_wait_slot() {
  while [ "$((_case_par_launched - $(_case_par_done_count)))" -ge "$_case_par_max" ]; do
    wait -n 2>/dev/null || true
    [ -n "$(jobs -rp)" ] || break
  done
}

run_cases() {
  _json_mode="$1"
  _stayed_green=0; _always_red=0; _errors=0; _uncovered_count=0; _regression_green=0
  _stayed_names=(); _always_names=(); _error_names=(); _uncovered_names=()
  _executed_names=()
  _results_json=""
  local checkers=() name case_list=() reg
  local all=() ; while IFS= read -r name; do all+=("$name"); done < <(all_registered_checkers)
  if [ -n "${_only_csv}" ]; then
    # --only: restrict the run to the named registered checkers. An unregistered name is a usage
    # error (exit 2), never a silent no-op — a narrowed run that silently ran nothing would be
    # indistinguishable from a green one (hard rule 3b).
    local on
    for on in ${_only_csv//,/ }; do
      on="${on//[[:space:]]/}"
      [ -n "$on" ] || continue
      if ! _in_list "$on" ${all[@]+"${all[@]}"}; then
        echo "checker-mutation-check: ERROR — --only names an unregistered checker: ${on}" >&2
        return 2
      fi
      _in_list "$on" ${checkers[@]+"${checkers[@]}"} || checkers+=("$on")
    done
    if [ "${#checkers[@]}" -eq 0 ]; then
      echo "checker-mutation-check: ERROR — --only carried no checker name ('${_only_csv}')" >&2
      return 2
    fi
  else
    checkers=(${all[@]+"${all[@]}"})
  fi
  for name in "${checkers[@]}"; do
    if has_case "$name"; then
      case_list+=("$name")
    else
      _uncovered_count=$((_uncovered_count + 1)); _uncovered_names+=("$name")
    fi
  done
  # The two AC5 regression cases are part of the mechanism's WHOLE-STORE self-check, not of a
  # per-delta judgment — in --only mode they are out of scope by construction (the full-tier
  # registration still runs them every round).
  if [ -z "${_only_csv}" ]; then
    for reg in regression-rename-negative-control-probe regression-live-telemetry-empty-activity; do
      if has_case "$reg"; then
        case_list+=("$reg")
      else
        _uncovered_count=$((_uncovered_count + 1)); _uncovered_names+=("$reg")
      fi
    done
  fi
  # Any --meta-inject short-circuits the case loop: the injection IS the broken state being
  # demonstrated (parser empty / loop skipped / detection inverted), so the gate must fail
  # without paying the cost of a real run. The per-case behavior is tested by the plain run.
  if [ -n "${meta_inject}" ]; then
    case_list=()
  fi

  local start_ms end_ms
  start_ms="$(now_ms)"
  _executed_names=(${case_list[@]+"${case_list[@]}"})
  # The 82 cases run BOUNDED-PARALLEL (see the _case_par_* pool above). Each case owns its workdir
  # and its own subshell; its exit code comes back through the results FILE, never through a parent
  # variable, and the NAME/ORDER stay in the parent's `case_list` — so the classification below reads
  # a channel the child actually controls, not the child's self-report. Empty case_list (--meta-inject)
  # stays a no-op: the loop body never runs and the bare `wait` below has no children.
  _case_par_resolve_max
  local _res_dir _case_rc_name _case_rc_val
  _res_dir="$(mktemp -d "${TMPDIR:-/tmp}/cmc-results-XXXXXX")"
  _case_par_results_file="${_res_dir}/results"
  : > "$_case_par_results_file"
  _case_par_launched=0
  for name in "${case_list[@]}"; do
    local workdir
    workdir="$(mktemp -d "${TMPDIR:-/tmp}/cmc-case-XXXXXX")"
    _case_par_wait_slot
    _case_par_launched=$((_case_par_launched + 1))
    ( if run_one_case "$name" "$workdir"; then _rc=0; else _rc=$?; fi; printf '%s|%s\n' "$name" "$_rc" >> "$_case_par_results_file"; rm -rf "$workdir" ) &
  done
  # Reap EVERY case before reading the channel — after this line every appended line is complete and
  # every workdir has been removed. (This `wait` is also what makes the loop's `&` a real
  # parallelization rather than a fire-and-forget: it is the join point the classification needs.)
  wait
  declare -A _case_rc=()
  while IFS='|' read -r _case_rc_name _case_rc_val; do
    [ -n "$_case_rc_name" ] || continue
    _case_rc["$_case_rc_name"]="$_case_rc_val"
  done < "$_case_par_results_file"
  rm -rf "$_res_dir"
  for name in "${case_list[@]}"; do
    local exit_code res
    # A name with NO line means its subshell died before reporting (killed / infra failure). That is
    # an ERROR, never a pass: fail-closed on a missing channel entry (hard rule 3b — "读不懂输入"
    # must not share the output shape of "合格"). exit 2 is the case-script infra-error code.
    if [ -n "${_case_rc[$name]+set}" ]; then exit_code="${_case_rc[$name]}"; else exit_code=2; fi
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
  # Narrowed runs say so LOUDLY (hard rule 3b): `checkers_total` is a manifest fact (whole store),
  # so a reader must never mistake "1 case ran" for "71 checkers verified".
  if [ -n "${_only_csv}" ]; then
    echo "checkers_executed: ${#_executed_names[@]}"
    echo "only (delta-narrowed — ⛔ NOT the whole manifest): ${_executed_names[*]}"
  fi
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
  elif [ -n "${_only_csv}" ]; then
    echo "RESULT: PASS — every checker IN THIS DELTA went RED under its injected defect and GREEN on restore (narrowed run; the whole-store set is the full-tier registration's job)."
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
  printf '{"checkers_total":%d,"checkers_with_mutation":%d,"mutations_that_stayed_green":%d,"stayed_green":[%s],"mutations_that_always_red":%d,"always_red":[%s],"errors":%d,"error_names":[%s],"uncovered":[%s],"results":%s,"duration_ms":%d,"only":[%s],"checkers_executed":[%s]}\n' \
    "$(registered_count)" "$(covered_count)" \
    "$_stayed_green" "$(join_json_names ${_stayed_names[@]+"${_stayed_names[@]}"})" \
    "$_always_red" "$(join_json_names ${_always_names[@]+"${_always_names[@]}"})" \
    "$_errors" "$(join_json_names ${_error_names[@]+"${_error_names[@]}"})" \
    "$(join_json_names ${_uncovered_names[@]+"${_uncovered_names[@]}"})" \
    "$_results_json" \
    "$_run_duration_ms" \
    "$(csv_to_json_array "${_only_csv}")" \
    "$(join_json_names ${_executed_names[@]+"${_executed_names[@]}"})"
  return "$overall"
}

# csv_to_json_array <csv> — emit a JSON string array from a comma-separated list ([] for empty).
csv_to_json_array() {
  local _csv="$1" _first=1 _n
  if [ -n "$_csv" ]; then
    for _n in ${_csv//,/ }; do
      _n="${_n//[[:space:]]/}"
      [ -n "$_n" ] || continue
      [ "$_first" -eq 1 ] || printf ','
      printf '"%s"' "$_n"
      _first=0
    done
  fi
}

# ── --check-changed (change-tier companion) ────────────────────────────────────────────────────────

# The first resolvable delta base under $repo_root. Empty + non-zero when none resolves (a non-git
# root, or a checkout with no develop/master) — "读不懂输入" must not be turned into "no carriers".
delta_base() {
  local _b
  for _b in develop origin/develop master origin/master; do
    if git -C "$repo_root" rev-parse --verify --quiet "${_b}^{commit}" >/dev/null 2>&1; then
      printf '%s\n' "$_b"
      return 0
    fi
  done
  return 1
}

# This delta's changed paths, repo-relative, deduped — committed branch delta (three-dot, so a
# develop that advanced past the fork does not show up as OUR change) ∪ working-tree delta vs HEAD
# ∪ untracked. A committed change and an uncommitted one are both "this delta" (the worker runs the
# scoped gate before AND after committing).
delta_files() {
  local _base
  _base="$(delta_base)" || return 1
  { git -C "$repo_root" diff --name-only "${_base}...HEAD" 2>/dev/null || true
    git -C "$repo_root" diff --name-only HEAD 2>/dev/null || true
    git -C "$repo_root" ls-files --others --exclude-standard 2>/dev/null || true
  } | sed -e 's|^\./||' -e '/^[[:space:]]*$/d' | sort -u
}

run_changed() {
  local _json="$1"
  local _base _delta _f _n _rc=0
  if ! _base="$(delta_base)"; then
    echo "checker-mutation-check [--check-changed]: NOT-EVALUATED — no delta base (develop / origin/develop / master / origin/master) resolvable under ${repo_root}; cannot derive this change's checker carriers."
    return 0
  fi
  if ! _delta="$(delta_files)"; then
    echo "checker-mutation-check [--check-changed]: NOT-EVALUATED — git could not enumerate the delta against ${_base} under ${repo_root}."
    return 0
  fi

  # Names of the REGISTERED checkers this delta carries — either the checker script itself or its
  # mutation case (editing the case changes what the checker is proven to catch).
  local _reg_list=" $(all_registered_checkers | tr '\n' ' ')"
  local carriers=() registry_hit=0
  while IFS= read -r _f; do
    [ -n "$_f" ] || continue
    case "$_f" in
      plugin/scripts/runner-static-gate.ts|scripts/test.sh|.github/workflows/*.yml) registry_hit=1 ;;
    esac
    case "$_f" in
      plugin/scripts/checker-mutation-cases/*.sh) _n="$(basename "$_f" .sh)" ;;
      plugin/scripts/*.sh|plugin/scripts/*.ts)
        _n="$(basename "$_f")"; _n="${_n%.sh}"; _n="${_n%.ts}" ;;
      *) continue ;;
    esac
    if [ "${_reg_list#*" $_n "}" != "$_reg_list" ]; then
      _in_list "$_n" ${carriers[@]+"${carriers[@]}"} || carriers+=("$_n")
    fi
  done <<< "$_delta"

  if [ "${#carriers[@]}" -eq 0 ] && [ "$registry_hit" -eq 0 ]; then
    echo "checker-mutation-check [--check-changed]: NOT-EVALUATED — this delta (base ${_base}) carries no checker carrier (no registered checker script, no mutation case, and no manifest source), so no mutation case of it can be stale. The whole-store set is still verified by the full-tier registration."
    return 0
  fi

  # The manifest source moved ⇒ the registered SET may have grown ⇒ re-verify the whole-manifest
  # 覆盖度 (uncovered) HERE, at the changer's gate — this is the AC1b dimension ("a new checker with
  # no mutation case can never silently slip through") arriving at the task that added it instead of
  # at an unrelated task's fan-in. Cheap: --list-grade file existence, no case execution.
  local uncovered=() _nm
  if [ "$registry_hit" -eq 1 ]; then
    while IFS= read -r _nm; do has_case "$_nm" || uncovered+=("$_nm"); done < <(all_registered_checkers)
    if [ "${#uncovered[@]}" -gt 0 ]; then
      _rc=1
      echo "checker-mutation-check [--check-changed]: RED — the manifest source (runner-static-gate.ts / scripts/test.sh / .github/workflows) changed in this delta and ${#uncovered[@]} registered checker(s) have NO mutation case:"
      printf '  - %s\n' "${uncovered[@]}"
    else
      echo "checker-mutation-check [--check-changed]: manifest source changed in this delta — all $(registered_count) registered checkers have a mutation case (uncovered = 0)."
    fi
  fi

  if [ "${#carriers[@]}" -eq 0 ]; then
    if [ "$_json" = "1" ]; then
      printf '{"mode":"check-changed","delta_base":"%s","registry_changed":true,"carriers":[],"uncovered":[%s],"checkers_total":%d,"result":"%s"}\n' \
        "$_base" "$(join_json_names ${uncovered[@]+"${uncovered[@]}"})" "$(registered_count)" \
        "$([ "$_rc" -eq 0 ] && echo pass || echo fail)"
    else
      echo "checker-mutation-check [--check-changed]: no checker carrier in this delta — 只做了 manifest 覆盖度复验（未执行任何 mutation case；whole-store 全量仍由 full-tier 注册承担）。"
      echo "checkers_total: $(registered_count)"
      echo "uncovered: ${#uncovered[@]}"
      echo "duration_ms: 0"
      if [ "$_rc" -ne 0 ]; then
        echo "RESULT: FAIL — a registered checker has no mutation case (uncovered > 0)."
      else
        echo "RESULT: PASS — manifest coverage verified; nothing else to judge for this delta."
      fi
    fi
    return "$_rc"
  fi

  echo "checker-mutation-check [--check-changed]: delta base ${_base}; ${#carriers[@]} checker carrier(s) in THIS delta (⛔ not the whole $(registered_count)-checker manifest): ${carriers[*]}"
  _only_csv="$(IFS=,; echo "${carriers[*]}")"
  if [ "$_json" = "1" ]; then run_json || _rc=1; else run_plain || _rc=1; fi
  return "$_rc"
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
    --check-changed) cmd="check-changed" ;;
    --only) shift; _only_csv="${_only_csv:+${_only_csv},}${1:-}" ;;
    --json) json=1 ;;
    --repo-root) shift; repo_root="$1"; CASES_DIR="${repo_root}/plugin/scripts/checker-mutation-cases"; TEST_SH="${repo_root}/scripts/test.sh"; STATIC_GATE="${repo_root}/plugin/scripts/runner-static-gate.ts"; WORKFLOWS_GLOB="${repo_root}/.github/workflows/*.yml" ;;
    --meta-inject) shift; meta_inject="$1" ;;
    -*) die_usage ;;
    *) die_usage ;;
  esac
  shift
done

# --check-changed derives its own narrowing from the delta; an explicit --only would silently
# override it (fail-closed on the ambiguous combination rather than picking one).
if [ "$cmd" = "check-changed" ] && [ -n "$_only_csv" ]; then
  die_usage
fi

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
  check-changed)
    run_changed "$json"
    ;;
  selftest)
    run_selftest
    ;;
  *)
    die_usage
    ;;
esac
