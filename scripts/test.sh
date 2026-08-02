#!/usr/bin/env bash
# scripts/test.sh — the ONE canonical test-invocation entrypoint (ADR-019 / DIR-109, M173).
#
# Both CLAUDE.md's Commands section and .github/workflows/ci.yml call THIS script instead of
# each hand-writing their own copy of the test-file glob / concurrency flag / live-test
# exclusion list. That duplication (a `grep -vE 'serve-github|provider-abi-conformance|
# cli-edit-parity-conformance'` pattern written out independently in both places, with nothing
# keeping the two copies in sync) is the drift ADR-019 records and this script eliminates.
#
# Per ADR-019 decision #1, the live/conformance test files are NO LONGER excluded here by
# filename — each of the 3 declares its own in-file `node:test` skip condition (opt-in via
# QUAY_TEST_LIVE_GITHUB=1; see each file's own header comment), so this script's glob is safe
# to include them unconditionally: a credential-less run reports them `skipped`, not silently
# excluded, and setting the env var proves the opt-in path actually runs them live.
#
# Usage:
#   scripts/test.sh                                  # default groups product,engine; runs the full
#                                                    # deduped glob (governance files self-skip)
#   scripts/test.sh --group <name[,name]>            # run only the given group(s); sets QUAY_TEST_GROUPS
#   scripts/test.sh --group <name[,name]> <file...>  # run explicit files with QUAY_TEST_GROUPS set
#   scripts/test.sh --list-groups                    # report per-group file counts (deduped by realpath)
#   scripts/test.sh --list-files                     # print the selected file list (test support / AC6)
#   scripts/test.sh <file...>                         # just the given file(s), same default concurrency
#   scripts/test.sh --test-name-pattern=X <file>   # any extra node --test flag passes through
#   scripts/test.sh --experimental-test-coverage   # flags-only form also passes through
#   QUAY_TEST_LIVE_GITHUB=1 scripts/test.sh   # opt IN to the 3 live/conformance files too
#
# Layer grouping (gap-test-suite-has-no-layer-grouping):
#   Every test file declares its layer at the very top: `// @test-group <name>` where name is
#   one of product / engine / governance (AC1). The DEFAULT for an undeclared file is `engine`
#   (AC7) — the current work surface, so a missed declaration never silently vanishes.
#
#   - product     packages/*/test/ — Core CLI, Provider ABI, gate engine, web UI
#   - engine      methodology EXECUTION path (plugin/test + the execution-path tests under
#                 experiments/quay-perpetual-stream/test/)
#   - governance  exp5 metering (PARKED but not deleted — exp6 phase-2 needs it; the in-file
#                 skip block makes it visible as `skipped` in default runs instead of absent)
#
#   The glob now ALSO includes experiments/quay-perpetual-stream/test/*.test.mjs (AC2), so the
#   44 previously-invisible files always appear in the output. Symlinks under that dir that
#   point back into plugin/test/ are deduped by realpath (AC3) so they never run twice.
#   Non-default-group files self-skip BEFORE their heavy imports (AC8), so `--group product`
#   does not pay the governance load cost. Default (no --group) = product,engine (AC4).
#
# --test-concurrency=8 is the default (ADR-019: measured 10.3% faster than the runtime default
# with zero correctness regression across repeated runs, 514/514 pass at concurrency 4/8/16).
# A later --test-concurrency=N on the command line overrides this (node --test is last-flag-wins).
#
# gap-split-or-commit-not-continuously-checked: this script also runs the WHOLE-TASK-STORE
# split-or-commit scan (it0-split-or-commit-check.ts, DIR-026's PARENT-DONE-IFF-CHILDREN /
# SELECT-SPLIT / CHILD-LINK-SYMMETRY rules) on EVERY TEST-RUNNING invocation — not the
# single-task `quay gate --gate split-or-commit <id>` form, and not only opportunistically
# inside a milestone's own Gate phase. Previously a violation introduced by one milestone's
# Land (which runs AFTER that milestone's own Gate phase) could sit undetected until some
# unrelated future milestone's Gate phase happened to run split-or-commit next. Since this
# script is the ONE canonical entrypoint CI and local runs both invoke (ADR-019/DIR-109),
# wiring it here closes that gap for both surfaces at once — CI inherits it via its existing
# `bash scripts/test.sh` step, no separate ci.yml job needed. It runs unconditionally for any
# path that RUNS tests (even when specific test files are named) because it is a repo-wide
# invariant, independent of which test files were requested, and it is fast (whole-store scan
# of ~450 tasks completes in well under a second). The metadata modes --list-groups/--list-files
# do NOT run tests, so they skip the scan.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# ── group resolution helpers (gap-test-suite-has-no-layer-grouping) ──────────────────────────────

# group_of <file> — echo the declared `// @test-group <name>` (default: engine, AC7).
# Only product|engine|governance are valid; a missing OR unrecognized declaration falls back
# to engine so a typo can never silently remove a file from the default run.
group_of() {
  local f="$1" g
  g="$(grep -m1 -oE '@test-group[[:space:]]+[a-z]+' "$f" 2>/dev/null | awk '{print $2}' || true)"
  case "${g:-}" in
    product|engine|governance) echo "$g" ;;
    *) echo "engine" ;;
  esac
}

# build_deduped_files — echo the union glob, deduped by realpath (AC3). One file per line.
build_deduped_files() {
  shopt -s nullglob
  local glob=(packages/*/test/*.test.mjs plugin/test/*.test.mjs experiments/quay-perpetual-stream/test/*.test.mjs)
  shopt -u nullglob
  declare -A seen=()
  local f rp
  for f in "${glob[@]}"; do
    rp="$(realpath "$f")"
    if [ -z "${seen[$rp]:-}" ]; then
      seen[$rp]=1
      printf '%s\n' "$rp"
    fi
  done
}

# effective_groups — echo the groups a given run should include (default product,engine, AC4).
effective_groups() {
  echo "product,engine"
}

# in_group <group> <csv> — return 0 iff group is in the comma-separated list.
in_group() {
  local g="$1" csv="$2"
  [[ ",${csv}," == *",${g},"* ]]
}

# is_default_set <csv> — return 0 iff csv is exactly the default set {product,engine} (AC6).
is_default_set() {
  [ "${1:-}" = "product,engine" ]
}

# select_files <groups-csv> — echo the files to run for the given groups (respecting the
# default-set self-skip passthrough so governance reports `skipped` rather than absent, AC4/AC6).
select_files() {
  local groups="$1" f g
  while IFS= read -r f; do
    g="$(group_of "$f")"
    if in_group "$g" "$groups"; then
      printf '%s\n' "$f"
    elif [ "$g" = "governance" ] && is_default_set "$groups"; then
      # governance self-skips via its in-file block; keep it in the run so it is VISIBLE.
      printf '%s\n' "$f"
    fi
  done < <(build_deduped_files)
}

# list_groups — per-group counts over the full deduped glob (AC10).
list_groups() {
  declare -A counts=([product]=0 [engine]=0 [governance]=0)
  local f g
  while IFS= read -r f; do
    g="$(group_of "$f")"
    counts[$g]=$(( ${counts[$g]:-0} + 1 ))
  done < <(build_deduped_files)
  printf 'product:    %d\n' "${counts[product]:-0}"
  printf 'engine:     %d\n' "${counts[engine]:-0}"
  printf 'governance: %d\n' "${counts[governance]:-0}"
  local total=$(( ${counts[product]:-0} + ${counts[engine]:-0} + ${counts[governance]:-0} ))
  printf 'total:      %d (deduped by realpath)\n' "$total"
}

# run_selected <groups-csv> — build the selected file list and exec node --test. Runs the
# split-or-commit whole-store scan first (same invariant as the default/no-args path).
run_selected() {
  local groups="$1"
  echo "== split-or-commit whole-store check (DIR-026, gap-split-or-commit-not-continuously-checked) =="
  bash "${repo_root}/plugin/scripts/it0-split-or-commit-check.sh" "${repo_root}"
  export QUAY_TEST_GROUPS="$groups"
  local files=() f
  while IFS= read -r f; do files+=("$f"); done < <(select_files "$groups")
  if [ "${#files[@]}" -eq 0 ]; then
    echo "scripts/test.sh: no test files matched groups '$groups' (packages/*/test/*.test.mjs, plugin/test/*.test.mjs, experiments/quay-perpetual-stream/test/*.test.mjs)" >&2
    exit 1
  fi
  exec node --test --test-concurrency=8 "${files[@]}"
}

# ── argument dispatch ────────────────────────────────────────────────────────────────────────────

groups=""
if [ "${1:-}" = "--group" ]; then
  groups="${2:-}"
  if [ -z "${groups}" ]; then
    echo "scripts/test.sh: --group requires a group name (product|engine|governance, comma-separated)" >&2
    exit 2
  fi
  shift 2
fi

if [ "${1:-}" = "--list-groups" ]; then
  # Metadata mode (AC10) — no test run, no split-or-commit scan. Always reports the FULL
  # deduped glob's per-group counts, independent of any --group.
  list_groups
  exit 0
elif [ "${1:-}" = "--list-files" ]; then
  # Metadata mode (test support / AC6) — print the selected file list, one per line. Respects
  # --group if given, else the default product,engine set.
  if [ -n "${groups}" ]; then
    select_files "$groups"
  else
    select_files "$(effective_groups)"
  fi
  exit 0
elif [ -n "${groups}" ]; then
  if [ "$#" -eq 0 ]; then
    # Run the glob filtered to the requested groups.
    run_selected "$groups"
  else
    # Explicit files with the group env set (in-file skips apply).
    export QUAY_TEST_GROUPS="$groups"
    exec node --test --test-concurrency=8 "$@"
  fi
fi

if [ "$#" -eq 0 ]; then
  # Default: product,engine (AC4). Governance files are passed through too — they self-skip,
  # so they report `skipped`, not absent (ADR-019 decision #1 precedent). run_selected runs
  # the split-or-commit whole-store scan.
  run_selected "$(effective_groups)"
elif [ "${1:-}" = "--for-task" ]; then
  echo "== split-or-commit whole-store check (DIR-026, gap-split-or-commit-not-continuously-checked) =="
  bash "${repo_root}/plugin/scripts/it0-split-or-commit-check.sh" "${repo_root}"
  # gap-test-selection-not-scoped-to-touches: mechanical per-task test selection. `scripts/test.sh
  # --for-task <id>` delegates to select-tests-for-touches.ts (which resolves the task's ## Touches
  # to a test set) and runs EXACTLY that set. Additive: the full-suite default and the explicit-file
  # form above are unchanged. `--allow-thin` passes through to the selector (see its exit codes).
  task_id="${2:-}"
  if [ -z "${task_id}" ]; then
    echo "scripts/test.sh: --for-task requires a task id" >&2
    exit 2
  fi
  shift 2
  allow_thin_flag=""
  sel_mode="--paths-only"     # default: emit paths for test.sh to run
  explicit_mode=""            # set when the user passed --json/--paths-only and wants output, not a run
  rest_args=()
  for a in "$@"; do
    if [ "${a}" = "--allow-thin" ]; then
      allow_thin_flag="--allow-thin"
    elif [ "${a}" = "--json" ] || [ "${a}" = "--paths-only" ]; then
      # Selector-only output modes. Forwarding them to `node --test` is a fatal "bad option" error;
      # instead honor them as a "show me the selection" request: run the selector in that mode and
      # print its output, never a test run.
      sel_mode="${a}"
      explicit_mode=1
    else
      rest_args+=("${a}")
    fi
  done
  if sel_out="$(node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/select-tests-for-touches.ts" --root "${repo_root}" --task "${task_id}" ${sel_mode} ${allow_thin_flag})"; then
    sel_code=0
  else
    sel_code=$?
  fi
  if [ -n "${explicit_mode}" ]; then
    # The user asked for the selector's output, not a test execution — print it and exit with the
    # selector's own code (so `test-selection-thin` still surfaces non-zero).
    printf '%s\n' "${sel_out}"
    exit "${sel_code}"
  fi
  # A here-string always appends a newline, so `mapfile <<< ""` yields a 1-element [""] array — the
  # empty case MUST be guarded on the string itself, not on the array length.
  if [ -z "${sel_out}" ]; then
    if [ "${sel_code}" -eq 2 ]; then
      echo "scripts/test.sh: --for-task ${task_id} — selector could not resolve the task (exit 2)" >&2
      exit 2
    fi
    if [ -n "${allow_thin_flag}" ]; then
      # --allow-thin + zero tests to run: nothing to do, and the user explicitly accepted thin.
      echo "scripts/test.sh: --for-task ${task_id} — selector selected 0 test files (thin allowed); nothing to run, full suite still runs at fan-in" >&2
      exit 0
    fi
    echo "scripts/test.sh: --for-task ${task_id} selected no test files (selector exit ${sel_code}); add --allow-thin to force" >&2
    exit 1
  fi
  mapfile -t files <<< "${sel_out}"
  # Run the selected set. A thin selector (sel_code != 0) still runs what was selected but the overall
  # exit is non-zero — fail-loud under-selection must never be masked by a green test run.
  set +e
  # Pass-through flags (e.g. --test-name-pattern=X) must precede the file list: node --test only
  # honors --test-name-pattern when it appears BEFORE the named files (after them it is ignored,
  # which would run the whole file — and for this self-referential test, recurse).
  node --test --test-concurrency=8 "${rest_args[@]}" "${files[@]}"
  test_code=$?
  set -e
  if [ "${sel_code}" -ne 0 ]; then
    echo "scripts/test.sh: --for-task ${task_id} — test-selection-thin (selector exit ${sel_code}); re-run with --allow-thin to suppress" >&2
    exit "${sel_code}"
  fi
  exit "${test_code}"
else
  echo "== split-or-commit whole-store check (DIR-026, gap-split-or-commit-not-continuously-checked) =="
  bash "${repo_root}/plugin/scripts/it0-split-or-commit-check.sh" "${repo_root}"
  # Explicit file list (no --group): QUAY_TEST_GROUPS stays unset, so in-file skips do not
  # trigger and the named files run in full.
  exec node --test --test-concurrency=8 "$@"
fi
