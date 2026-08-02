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
#   scripts/test.sh                          # full safe-by-default suite, --test-concurrency=8
#   scripts/test.sh <file...>                 # just the given file(s), same default concurrency
#   scripts/test.sh --test-name-pattern=X <file>   # any extra node --test flag passes through
#   scripts/test.sh --experimental-test-coverage   # flags-only form also passes through
#   QUAY_TEST_LIVE_GITHUB=1 scripts/test.sh   # opt IN to the 3 live/conformance files too
#
# --test-concurrency=8 is the default (ADR-019: measured 10.3% faster than the runtime default
# with zero correctness regression across repeated runs, 514/514 pass at concurrency 4/8/16).
# A later --test-concurrency=N on the command line overrides this (node --test is last-flag-wins).
#
# gap-split-or-commit-not-continuously-checked: this script also runs the WHOLE-TASK-STORE
# split-or-commit scan (it0-split-or-commit-check.ts, DIR-026's PARENT-DONE-IFF-CHILDREN /
# SELECT-SPLIT / CHILD-LINK-SYMMETRY rules) on EVERY invocation — not the single-task
# `quay gate --gate split-or-commit <id>` form, and not only opportunistically inside a
# milestone's own Gate phase. Previously a violation introduced by one milestone's Land (which
# runs AFTER that milestone's own Gate phase) could sit undetected until some unrelated future
# milestone's Gate phase happened to run split-or-commit next. Since this script is the ONE
# canonical entrypoint CI and local runs both invoke (ADR-019/DIR-109), wiring it here closes
# that gap for both surfaces at once — CI inherits it via its existing `bash scripts/test.sh`
# step, no separate ci.yml job needed. It runs unconditionally (even when specific test files
# are named on the command line) because it is a repo-wide invariant, independent of which
# test files were requested, and it is fast (whole-store scan of ~450 tasks completes in well
# under a second).

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "== split-or-commit whole-store check (DIR-026, gap-split-or-commit-not-continuously-checked) =="
bash "${repo_root}/plugin/scripts/it0-split-or-commit-check.sh" "${repo_root}"

if [ "$#" -eq 0 ]; then
  # Default glob: every *.test.mjs under any package's test/ dir, plus plugin/test/.
  # (ADR-019 decision #4 names a follow-up mechanical self-check, DIR-110, that fails closed if
  # a new test directory isn't reachable by this glob — out of scope for this script itself.)
  shopt -s nullglob
  files=(packages/*/test/*.test.mjs plugin/test/*.test.mjs)
  shopt -u nullglob
  if [ "${#files[@]}" -eq 0 ]; then
    echo "scripts/test.sh: no test files matched packages/*/test/*.test.mjs or plugin/test/*.test.mjs" >&2
    exit 1
  fi
  exec node --test --test-concurrency=8 "${files[@]}"
elif [ "${1:-}" = "--for-task" ]; then
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
  exec node --test --test-concurrency=8 "$@"
fi
