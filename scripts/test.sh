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
# TEST-FRAMEWORK POLICY (gap-no-test-framework-policy-for-new-tests, AC1): NEW test files MUST
# use `node:test` — `import { test } from "node:test"`. This script enforces that mechanically via
# the test-framework-policy static check below (AC6): every file in the glob must either import
# node:test or be on the legacy exemption list (`plugin/test-framework-policy-exemptions.txt`,
# currently 34 files — the shrink-only ratchet of AC4, it can only get shorter, never longer).
# NEW files must also carry a `// @test-group <product|engine|governance|serial|lowconc>`
# declaration (AC5); existing files may omit it and default to `engine`. `serial` is the
# load-sensitive family routed to its own concurrency-1 phase — nested-suite-spawn + real-wall-
# clock-wait + the real-install install/quay-init family, the latter admitted at round 162 after
# rotating flakes across groups under full-suite load
# (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests +
# gap-install-family-tests-rotate-flakes-under-full-suite); `lowconc` is the hermetic-but-load-
# sensitive session-observation family routed to its own concurrency-3 phase
# (gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive). The check does NOT migrate the 34
# legacy hand-rolled-harness files — it stops the 35th and turns each existing file's eventual
# conversion (e.g. relation-sync's harness) into the ratchet.
#
# TEST-ISOLATION CONTRACT (gap-test-isolation-contract-is-unwritten, AC1-AC6): a test must never
# touch something it does not exclusively own (fixed __dirname/.tmp-* paths, the SHARED build
# artifacts packages/<pkg>/dist/ + plugin/vendor/, the whole scripts/test.sh runner, and a
# hand-rolled harness's silent `process.exit(1)` failure path). The test-isolation static check
# below REPORTS every current violation on every run but does NOT block on the known/baselined
# ones ("报出而不阻断", AC6); its data file (`plugin/test-isolation-violations.txt`) is a
# SHRINK-ONLY ratchet (AC5) — a NEW violation fails the run, so the fourth instance of this class
# is stopped when it is WRITTEN, not after the suite goes red.
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
#   scripts/test.sh --test-concurrency=4           # flags-only: extra node --test flag + the DEFAULT glob
#   scripts/test.sh --experimental-test-coverage   # flags-only form also passes through (default glob kept)
#   QUAY_TEST_LIVE_GITHUB=1 scripts/test.sh   # opt IN to the 3 live/conformance files too
#   scripts/test.sh --for-task <id>                # task-scoped: change-relevant static checks + the
#                                                  #   task's ## Touches-selected test set (scoped tier)
#   scripts/test.sh --scoped <id>                  # same as --for-task (the scoped measure surface)
#   scripts/test.sh --scoped <file...>             # scoped tier keyed to the given files as touches
#   scripts/test.sh --static-checks                # gate-only: run the COMPLETE static-check set, no tests
#
# SCOPED STATIC-CHECK TIER (gap-scoped-runs-pay-full-static-check-overhead, AC1/AC2/AC6):
#   A task-scoped run (`--for-task` / `--scoped`) runs the change-relevant static-check subset —
#   checkers whose object intersects the task's `## Touches` plus the ## Contract consumer on the
#   TOUCHED task files — SKIPPING checker-mutation-check (~13s) and unrelated repo-level ratchets.
#   The COMPLETE set (run_static_checks) is unchanged and always runs in full-suite mode (the outer
#   verification-round gate is NOT weakened); a scoped skip is DEFERRED to the full gate, never
#   dropped. Trade-off: scoped = fast feedback on the change; full = complete gate (AC4-ii:
#   an unrelated repo-level ratchet violation is caught by full, not by the scoped run).
#
# Layer grouping (gap-test-suite-has-no-layer-grouping):
#   Every test file declares its layer at the very top: `// @test-group <name>` where name is
#   one of product / engine / governance / serial / lowconc (AC1). The DEFAULT for an undeclared
#   file is `engine` (AC7) — the current work surface, so a missed declaration never silently
#   vanishes.
#
#   - product     packages/*/test/ — Core CLI, Provider ABI, gate engine, web UI; plus
#                 plugin/test/plugin-packaging.test.mjs — plugin-packaging (incl. M136's
#                 sync-vendor.sh --check scan) is a PRODUCT packaging path, not engine
#                 (AC8 of gap-sync-vendor-drift-mislabelled-as-task-schema).
#   - engine      methodology EXECUTION path (the rest of plugin/test + the execution-path
#                 tests under experiments/quay-perpetual-stream/test/)
#   - governance  exp5 metering (PARKED but not deleted — exp6 phase-2 needs it; the in-file
#                 skip block makes it visible as `skipped` in default runs instead of absent)
#   - serial      KNOWN-LOAD-SENSITIVE A/B-class family (nested-suite-spawn, real-wall-clock-wait)
#                 + the REAL-INSTALL install/quay-init family, routed OUT of the concurrency-N body
#                 into its own phase at concurrency 1. The serial admission criterion
#                 (gap-serial-group-recompose-nested-runner-criterion — nested-runner-only) was
#                 EXTENDED at round 162 to admit the install/quay-init real-install family after it
#                 rotated flakes across groups under full-suite load (rounds 160/161/162 — a
#                 different file each round: drift-report/governance, loop-core/serial,
#                 install-config/lowconc): the whole family is now consolidated into the
#                 concurrency-1 serial phase (gap-install-family-tests-rotate-flakes-under-full-suite).
#                 (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests).
#   - lowconc     hermetic-but-load-sensitive B-class session-observation family (each private
#                 socket / wall-clock wait) — its own phase at concurrency 3. The install/quay-init
#                 family LEFT this group for serial in round 162
#                 (gap-install-family-tests-rotate-flakes-under-full-suite); only the session-
#                 observation wall-clock files remain.
#                 (gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive).
#
#   The glob now ALSO includes experiments/quay-perpetual-stream/test/*.test.mjs (AC2), so the
#   44 previously-invisible files always appear in the output. Symlinks under that dir that
#   point back into plugin/test/ are deduped by realpath (AC3) so they never run twice.
#   Non-default-group files self-skip BEFORE their heavy imports (AC8), so `--group product`
#   does not pay the governance load cost. Default (no --group) = product,engine (AC4).
#
# --test-concurrency default is now DERIVED (gap-no-resource-awareness-heavy-ops-run-blind, AC5):
#   default = max(1, floor(nproc / AMPLIFICATION))   with AMPLIFICATION = 1.0 (see
#   default_test_concurrency below). AMPLIFICATION was 2.1 (2026-08-03 measured process
#   amplification 17/8 ≈ 2.125) until the AC5 cost-side experiment finally ran
#   (gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible, 2026-08-08):
#   the same selected set at concurrency 1/4/8 produced ZERO cancelled at every level — the
#   cost-side criterion (CANCELLED dimension) that refuted "lower concurrency to avoid cancel".
#   Wall-clock is a SEPARATE axis: in this selected set c4 was fastest (24s vs 57.5s at 1, 27.3s
#   at 8 on this 4-core box), while the outer's full-suite rounds at laneCount 8 (13+ runs,
#   2026-08-08) were wall-clock FASTER than lane 4 (median ~783s vs ~1302s, −22%~−40%, directional
#   only — suite composition was changing). Do NOT read "nproc = wall-clock sweet spot" as the
#   derivation's justification: the derived default is now nproc (4 on this box) on the CANCELLED
#   dimension; wall-clock is a separate axis needing a controlled comparison
#   (gap-load-sensitive-serial-phase-unbounded-growth-measure-first AC2 lane 4 vs 8). The old
#   hardcoded 8 was a 4.25× oversubscription (17 processes on 4 cores), but the cost side of that
#   oversubscription was never shown to cancel/fail — the outer's own full-suite verification
#   rounds at laneCount 8 (13+ runs, 2026-08-08) all show cancelled 0. A later
#   --test-concurrency=N on the command line overrides the derived
#   default (node --test is last-flag-wins).
#
# gap-test-sh-flags-only-form-silently-runs-a-different-suite: the flags-only form
# (scripts/test.sh --test-concurrency=4, --experimental-test-coverage, ...) MUST keep the default
# file glob. Before the fix, "flags + no files" fell through to `node --test` with an EMPTY file
# list, so node auto-discovered ~3.7x more tests (8573 vs 2296, measured 2026-08-02) — a
# documented invocation silently swapped the whole suite. Now any remaining all-flag args are
# extra node --test flags PREPENDED to the selected glob, and every run self-reports its selection
# ("selected N files (groups=…)") so a changed selection can never be silent (AC4).
#
# SCOPE LIMITATION (REFUTE round-1, MAJOR → documented): only the `=` spelling of a value-taking
# flag (--test-concurrency=4, --test-name-pattern=X, ...) is covered by the flags-only branch.
# The SPACE-separated form (--test-concurrency 4) presents a bare non-flag token that is
# indistinguishable from a file path, so it still falls to the explicit-file branch — and, with no
# files, node auto-discovers (the pre-fix behavior, unchanged). Use the `=` form for flags-only
# runs; the space form with a value requires an explicit file list.
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

# ── criterion-cost recording (gap-no-criterion-records-its-own-cost-checker-cost-jsonl) ──────────
# Every checker executed by run_static_checks (and the scoped tier, which evals the SAME wrapped
# command lines) appends ONE `{name, ms, n, load, at}` line to .quay/checker-cost.jsonl on exit —
# pure append, zero judgment (no threshold, no flag). The load field splits "the criterion got
# slower" into "n got bigger" vs "the machine got busier" (the ready-pool-check 35.8→91.2→157.0
# attribution case). run_checker must be defined here, BEFORE run_static_checks / the scoped
# selector emit command lines that reference it.
source "${repo_root}/plugin/scripts/checker-cost-lib.sh"

# ── Node compile cache (gap-node-compile-cache-is-never-enabled-and-every-spawn-reparses) ──────────
# Every `node --experimental-strip-types` spawn in the suite re-parses .ts from source because
# NODE_COMPILE_CACHE was set nowhere in the repo (measured 2026-08-04: ~450ms cold vs ~150ms warm
# per spawn of plugin/scripts/task-schema.ts — ~2.6-3x per spawn, NOT suite wall-clock; see the
# task body for why wall-clock A/B is the wrong axis). Node's DEFAULT cache location is
# $TMPDIR/node-compile-cache — which on this machine is tmpfs (RAM); enabling the cache without
# pinning a DISK path would grow a compile cache in memory (the OOM family of
# gap-the-shipped-tick-doc-teaches-every-project-to-put-worktrees-in-tmpfs). So we pin it to a
# DISK, gitignored, repo-root-relative directory (`.quay/node-compile-cache`, covered by
# `**/.quay/node-compile-cache/` in .gitignore) and export it so EVERY spawn in the suite (incl.
# plugin/test subprocesses, AC4) inherits it.
# FAIL-OPEN (AC3): if the dir cannot be created we warn and leave the var unset — node then runs
# uncached (slow but correct). The cache is a PURE SPEEDUP, never a single point of failure. A
# user-supplied NODE_COMPILE_CACHE is honored verbatim (explicit opt-out from the disk default).
node_compile_cache_dir="${NODE_COMPILE_CACHE:-${repo_root}/.quay/node-compile-cache}"
if mkdir -p "${node_compile_cache_dir}" 2>/dev/null; then
  export NODE_COMPILE_CACHE="${node_compile_cache_dir}"
else
  echo "scripts/test.sh: WARNING — could not create NODE_COMPILE_CACHE dir '${node_compile_cache_dir}'; running uncached (slow but correct, AC3 fail-open)" >&2
fi

# ── per-file duration reporter wiring (gap-install-suite-cost-instrument-reporter-not-wired) ───────
# measure-suite-reporter.mjs EXISTS + is unit-tested, but the REAL full suite never loaded it (the
# 34 file-level wall-clock lines in the log were LEGACY harness self-prints, not reporter output).
# This helper produces the node --test reporter flags that load it into EVERY real-suite node --test
# invocation (main body, serial phase, lowconc phase, and the --group serial/lowconc paths) so the
# full-suite log carries per-file wall-clock for BOTH node:test files AND the 34 legacy harnesses
# (>34 covered files). The flags are DUAL-REPORTER: spec keeps the normal spec/TAP summary on stdout
# (the outer runner greps it for 判绿 markers), and measure-suite-reporter.mjs emits __PERFILE__ +
# __GROUP__ + __CEILING__ (封顶者/该拆) lines to stderr, which full-suite-runner.ts tees into
# .quay/full-suite.log. Mechanical anti-regression: plugin/test/measure-suite-reporter.test.mjs
# asserts this wiring exists, so removing it flips the suite red (the 7th instance is prevented).
suite_reporter_flags() {
  printf '%s\n' \
    "--test-reporter=spec" \
    "--test-reporter=${repo_root}/plugin/scripts/measure-suite-reporter.mjs" \
    "--test-reporter-destination=stdout" \
    "--test-reporter-destination=stderr"
}

# run_static_checks — the repo-wide invariants that run on EVERY FULL-SUITE-mode test-running
# invocation (the default, --group, flags-only, explicit files) AND on `--static-checks`.
# independent of which test files were requested (fast; the metadata modes --list-groups/
# --list-files skip them). CI inherits them because its only test step is `bash scripts/test.sh`.
#
# SCOPED TIER (gap-scoped-runs-pay-full-static-check-overhead, AC1/AC2/AC6): TASK-scoped runs
# (`--for-task <id>` / `--scoped <id>`) do NOT pay this full set every time — they run the
# change-relevant subset (run_scoped_static_checks_sel below): checkers whose object intersects
# the task's `## Touches` plus the ## Contract consumer on the touched task files, SKIPPING
# checker-mutation-check (~13s) and the unrelated repo-level ratchets. The complete set here is
# byte-unchanged (AC2 — the full-suite gate is NOT weakened); a scoped skip is DEFERRED to the
# full-suite gate, never dropped (AC4-ii: scoped = fast feedback on the change; full = complete gate).
# Each checker carries a `# @static-tier <always|change|full>` + `# @static-object <glob>…`
# annotation that select-static-checks-for-touches.ts parses (the SAME single source
# checker-mutation-check.sh parses — never a hand-maintained list, AC3).
run_static_checks() {
  # QUAY_TEST_NESTED — set by mark_nested() right before the outer suite's node --test. A nested
  # invocation (a test that spawns scripts/test.sh) inherits it and skips the whole-store checks
  # the OUTER suite already ran at its start (gap-suite-speed-under-a-297-second-sigma). Same-root
  # guard: a nested run in a DIFFERENT worktree keeps its own checks.
  if [ "${QUAY_TEST_NESTED:-}" = "1" ] && [ "${QUAY_TEST_NESTED_ROOT:-}" = "${repo_root}" ]; then
    echo "scripts/test.sh: QUAY_TEST_NESTED=1 — skipping static checks (nested invocation; outer suite ran them)"
    return 0
  fi
  # QUAY_TEST_SKIP_STATIC_CHECKS=1 — set by 0-match / pure-selector NESTED invocations (same shape as
  # QUAY_TEST_SKIP_DIST_BUILD): the outer suite already ran these whole-store checks at its start, and
  # a nested smoke run that matches 0 tests does not re-verify them. Skipping avoids a real race: a
  # sibling test's transient untracked fixture (runner-grouping AC7's zz-*-undeclared.test.mjs) can
  # appear as a spurious "NEW file without @test-group" to test-framework-policy-check if it exists
  # during this window (surfaced 2026-08-03 in the stranded+parser combined suite).
  if [ "${QUAY_TEST_SKIP_STATIC_CHECKS:-}" = "1" ]; then
    echo "scripts/test.sh: QUAY_TEST_SKIP_STATIC_CHECKS=1 — skipping static checks (nested 0-match/smoke run; outer suite ran them)"
    return 0
  fi
  # Parallel execution (gap-run-static-checks-zero-concurrency-can-parallelize): the ~20 checkers
  # below are independent, read-only, and share no state — the sequential run was structural
  # zero-concurrency. RUN_CHECKER_PARALLEL=1 makes run_checker launch each checker in the BACKGROUND,
  # bounded to STATIC_CHECK_CONCURRENCY (default nproc — "读 nproc"; set the env var for a fixed N).
  # The trailing run_checker_parallel_wait waits for all and fails closed (non-zero exit, set -e
  # abort) on ANY checker failure (AC3 — a failing checker's output + name are visible, never masked
  # by siblings), and every checker's cost row is still appended (AC4 — run_checker's
  # checker_cost_append completes before the wait observes it). The scoped tier leaves this unset.
  RUN_CHECKER_PARALLEL=1
  echo "== split-or-commit whole-store check (DIR-026, gap-split-or-commit-not-continuously-checked) =="
  # @static-tier full  (whole-store ratchet — deferred to the full-suite gate in scoped mode)
  run_checker "it0-split-or-commit-check" bash "${repo_root}/plugin/scripts/it0-split-or-commit-check.sh" "${repo_root}"
  echo "== test-framework-policy check (gap-no-test-framework-policy-for-new-tests, AC1/AC3-AC5) =="
  # @static-tier change
  # @static-object plugin/test/ packages/*/test/ experiments/*/test/
  run_checker "test-framework-policy-check" bash "${repo_root}/plugin/scripts/test-framework-policy-check.sh" "${repo_root}"
  echo "== test-isolation contract check (gap-test-isolation-contract-is-unwritten, AC1-AC6) =="
  # @static-tier change
  # @static-object plugin/test/ packages/*/test/ experiments/*/test/
  run_checker "test-isolation-check" bash "${repo_root}/plugin/scripts/test-isolation-check.sh" "${repo_root}"
  echo "== test-impl-census check (gap-experiment-legacy-reclaim-and-touches-heuristic AC5) =="
  # Mechanized criterion "被测实现不存在的测试文件随实现删除": a test file that imports a
  # scripts/<name> module that exists NOWHERE (plugin/scripts, experiments/scripts, repo scripts/
  # or the adjacent package scripts) is an impl-deleted test — the census measured 15 such files
  # still running every full suite. exit 1 red-lights the commit (set -euo pipefail) so a script
  # deleted/reclaimed without its test delete can never silently re-accumulate.
  # @static-tier change
  # @static-object plugin/test/ packages/*/test/ experiments/*/test/
  run_checker "test-impl-census-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/test-impl-census-check.ts" --root "${repo_root}"
  echo "== ## Contract consumer check (gap-dispatch-gate-has-no-checklist-and-no-trace, AC6) =="
  # gap-contract-ratchet-has-no-runner-and-grew-tenfold-unnoticed: this checker had NO runner — its
  # shrink-only ratchet list (docs/analysis/contract-violations.md) grew 1 -> 12 unnoticed because
  # the only consumer was an ad-hoc pre-dispatch run. Wiring it here (same place as the other three
  # whole-store checkers) gives every test-running invocation — and CI, which inherits it via its
  # single `bash scripts/test.sh` step — the ratchet enforcement for free. exit 1 on ratchet growth
  # aborts the suite (set -euo pipefail), so a NEW violation red-lights the commit, not the dispatch.
  # --no-block (gap-task-file-static-syntax-should-not-block-product-verification, option ①): this is
  # a TASK-FILE checker (it scans tasks/*.md Contract/AC syntax) — a task-file syntax issue is a
  # DIFFERENT risk class from "is the product code usable", so it must NOT stop the product-verification
  # round. --no-block records new violations in the grow-only ledger (.quay/task-file-violation-ledger.jsonl,
  # 只增不减 记账) but exits 0; the round proceeds to the test phase. Product-code checkers below keep
  # their blocking exit. The checker's DEFAULT mode (no --no-block) still blocks for maintenance/mutation.
  # @static-tier always
  # @static-scoped-mode subset-touched
  run_checker "task-contract-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/task-contract-check.ts" --root "${repo_root}" --no-block
  echo "== AC-carryover check (gap-nothing-checks-whether-a-done-task-left-its-acs-behind, AC6) =="
  # @static-tier full  (whole-store ratchet — deferred to the full-suite gate in scoped mode)
  # A done task may leave ACs unchecked ONLY if a successor `## Carries` section names them — the
  # gate on the gates: nothing previously noticed a done task closing with half its ACs unchecked and
  # no carrier (measured 2026-08-03: session-liveness closed done with 8/16 unchecked, stage-2
  # existed only because the outer happened to look). Wired here (same site as task-contract-check)
  # so CI — whose only test step is `bash scripts/test.sh` — inherits it for free. The legacy
  # baseline (docs/analysis/task-ac-carryover-baseline.md) is shrink-only: exit 1 on a NEW unowned
  # AC aborts the suite (set -euo pipefail), red-lighting a done task that just closed with
  # uncarried ACs instead of letting it merge silently.
  # --no-block (gap-task-file-static-syntax-should-not-block-product-verification, option ①): same
  # degradation as task-contract-check above — a NEW unowned AC is ledgered (grow-only) but does not
  # stop the verification round (task-file syntax ≠ product-code availability).
  run_checker "task-ac-carryover-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/task-ac-carryover-check.ts" --root "${repo_root}" --no-block
  echo "== ADR-016 screen-use check (gap-adr-016-carve-out-permits-the-whole-screen-hash, AC3) =="
  # ADR-016 Amendment 2026-08-04 boundary (c): whole-screen equality/hash of capture-pane is
  # forbidden. Code-position detection (a capture-pane result flowing into md5sum/sha1sum/cksum in
  # a shell script OR a fenced ```bash instruction block of a shipped/live tick doc), band 0..1
  # (the ONE active legacy observer — session-liveness.sh — is carried by the sibling task; a NEW
  # active violation red-lights the commit). Tick docs are scanned for their bash blocks because
  # shipped .md instruction blocks are same-weight as .sh (gap-adr016-md5-ban-violated-in-shipped-
  # md-and-checker-scope-gap AC3).
  # @static-tier change
  # @static-object **/*.sh **/*.bash plugin/loop/*-loop-tick.md orchestration/*-loop-tick.md plugin/scripts/adr016-screen-use-check.ts plugin/test/adr016-screen-use-check.test.mjs
  run_checker "adr016-screen-use-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/adr016-screen-use-check.ts" --root "${repo_root}"
  echo "== superseded-capability check (gap-retired-script-still-callable, AC5) =="
  # One capability = ONE implementation. A superseded implementation (the SUPERSEDED table in
  # capability-catalog.sh — currently send-keys-verified.sh, deleted 2026-08-10 under human ruling)
  # must NOT exist in the executable layer (plugin/scripts, plugin/test, packages/*/plugin vendored
  # copies) and must NOT be taught in SKILL/README positions. This mode asserts the invariant every
  # run, so a deleted superseded implementation can never silently regrow (target state ⑤).
  # @static-tier always
  run_checker "superseded-capability-check" bash "${repo_root}/plugin/scripts/capability-catalog.sh" --superseded-check
  echo "== dead-code-after-return check (gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived, AC6) =="
  # The 2026-08-03 TEMPORARY pin shape (`echo 8; return 0; <formula>` — a statement after a top-level
  # return) is the drift that made docs/ACs/tests report "derived" while the code returned a constant.
  # This checker bans that form across all shell scripts; a NEW instance red-lights the commit.
  # @static-tier change
  # @static-object **/*.sh **/*.bash
  run_checker "dead-code-after-return-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/dead-code-after-return-check.ts" --root "${repo_root}"
  echo "== strategic-doc-staleness check (gap-establish-daily-review-cadence-mechanism, AC2/AC3/AC8) =="
  # The generic strategic-doc staleness checker: scans docs/proposals + orchestration/*ROADMAP* for
  # unannotated references to classic-pipeline scripts ADR-022 deleted (prepare-milestone.js /
  # execute-milestone.js / milestone-worktree.ts). The six known-stale docs (the shrink-only
  # baseline) are reported but not counted; a NEW stale strategic doc exits 1 and aborts the suite
  # (set -euo pipefail), so a strategic doc silently pointing at deleted code red-lights the commit.
  # The AC8 pool-candidate regression (gap-prepare-milestone-no-size-aware-routing must be flagged)
  # is asserted in plugin/test/strategic-doc-staleness-check.test.mjs, not here.
  # @static-tier change
  # @static-object docs/proposals/ orchestration/
  run_checker "strategic-doc-staleness-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/strategic-doc-staleness-check.ts" --root "${repo_root}"
  echo "== drive-contract check (gap-drive-text-carries-data-not-behavior-outer-inner-handoff, AC3) =="
  # The drive-text contract checker: a drive text (the OUTER's dispatch instructions to the INNER)
  # must carry DATA only — behavior (concurrency, worktree, discipline) comes from the shipped
  # fast-mode-loop-tick.md, never restated in prose. If a drive text DOES assert an explicit task
  # order ("按 A→D→B 顺序") it MUST include the checkTouchesPair output that justifies it. Judgment
  # is POSITIONAL (order assertion + pair output coexist in the same text), never keyword-based
  # (ruling docs necessarily contain words like 并发派发 — a keyword checker self-hits 100%).
  # Scans the three normative drive-contract docs; a violation exits 1 and aborts the suite
  # (set -euo pipefail), red-lighting an order-asserting drive text without its mechanical evidence.
  # The AC4 negative control (order-without-output flags, +output clean) is exercised by the
  # checker's own mutation case and plugin/test/drive-contract-check.test.mjs.
  # @static-tier change
  # @static-object plugin/loop/fast-mode-loop-tick.md plugin/loop/orchestrator-loop-tick.md orchestration/QUAY-OUTER-HANDOFF.md
  run_checker "drive-contract-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/drive-contract-check.ts" --root "${repo_root}"
  echo "== judgment-consumer check (gap-judgment-computed-not-wired-to-action, AC2/AC3) =="
  # The 判据→消费动作 audit — the class-level discipline "每个机械判据必须有消费它的动作" made
  # mechanical. The registry (plugin/scripts/judgment-consumer-check.ts) lists every audited judgment
  # with the action that consumes it; a judgment declared `wired` whose consumer patterns do not
  # verify is the exact defect class (2026-08-10: deficit / not-yet-flipped / self-touch-scan — the
  # signal was computed, nothing acted on it) and red-lights the commit. A judgment with no consumer
  # is listed `unfinished` (never silently green). Exit 1 on drift (wired-but-missing or
  # unfinished-but-stale) aborts the suite. The mutation case exercises the wired→missing→restore
  # direction; plugin/test/judgment-consumer-check.test.mjs asserts the full-registry audit.
  # @static-tier change
  # @static-object orchestration/orchestrator-tick-core.md plugin/loop/fast-mode-tick-core.md plugin/scripts/judgment-consumer-check.ts plugin/scripts/ready-pool-check.ts plugin/scripts/slot-refill.ts plugin/scripts/touches-orthogonality-check.ts plugin/scripts/closure-lag-check.sh plugin/scripts/obligation-ledger.ts plugin/test/judgment-consumer-check.test.mjs
  run_checker "judgment-consumer-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/judgment-consumer-check.ts" --root "${repo_root}"
  echo "== threshold-scope check (gap-quantified-stop-conditions-have-no-scope, AC2/AC3/AC6/AC7/AC9) =="
  # The driver-doc prose hygiene checker: (1) a quantified stop/trigger condition must name its SET
  # and WINDOW — `needs-human 积压 ≥ 3` (no window) is the 2026-08-03 dispatch-freeze shape, its
  # positive control `窗口内新增 needs-human ≥ 3` must stay clean; paragraphs marked
  # `<!-- unmechanized: -->` / `<!-- unmechanizable: -->` are skipped AND the skip is reported via
  # `skippedByMarker` (silent skip == no findings is a failure mode this task exists to close).
  # (2) a backtick-named path must resolve (three-layer judgment: exact / basename / same-stem-diff-ext;
  # placeholders `NNN`/`<...>`/*/`{` skipped); the five `.js`→`.ts` migration leftovers the outer
  # already fixed are the calibration, and the 18 local-reference (basename-exists) paths must not
  # over-report. REPORT-ONLY (AC7): violations are listed but exit 0; the ONE blocking edge is the
  # shrink-only ratchet (docs/analysis/threshold-scope-violations.md) — a NEW violation exits 1 and
  # aborts the suite (set -euo pipefail), red-lighting a driver-doc edit that reintroduces an
  # unscoped threshold or a stale path.
  # @static-tier change
  # @static-object plugin/loop/fast-mode-loop-tick.md plugin/loop/orchestrator-loop-tick.md CLAUDE.md plugin/scripts/threshold-scope-check.ts plugin/test/threshold-scope-check.test.mjs docs/analysis/threshold-scope-violations.md
  run_checker "threshold-scope-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/threshold-scope-check.ts" --root "${repo_root}"
  echo "== state-worded-clause check (gap-ac41-actionize-state-worded-clauses, AC4) =="
  # The result-state-clause checker: the three execution cores must phrase every executable clause
  # as an ACTION + mechanically verifiable product, never a result state (自测绿/确保/保证/直到…绿).
  # The 2026-08-10 incident — orchestrator A15 ④'s 自测绿 (a result state, not an action) let two
  # suite-fix subagents behave oppositely (the file-quoting one read it as "observe until green" →
  # scope=main failure; the all-prose one happened to run the suite → scope=worktree success).
  # The ## Contract measure IS this checker's count over the three tick-cores, band 0. Exit 1 on a
  # NEW state-worded clause red-lights the commit (set -euo pipefail), so a result-state regression
  # in a tick-core is stopped when it is WRITTEN, not after the suite goes red.
  # @static-tier change
  # @static-object orchestration/manager-tick-core.md orchestration/orchestrator-tick-core.md orchestration/fast-mode-tick-core.md plugin/scripts/state-worded-clause-check.ts plugin/test/state-worded-clause-check.test.mjs
  run_checker "state-worded-clause-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/state-worded-clause-check.ts" --root "${repo_root}"
  echo "== red-on-omission audit (gap-ac41-red-on-omission-artifact, AC41 判据 3) =="
  # The AC41③ red-on-omission audit: every solidified behavior must be able to point at a reading
  # that turns RED when the behavior is NOT done; 指不出的视为未固化. The 2026-08-10 evidence —
  # A15 裁定5 in the 80-line execution core, read every tick, threshold explicit, counter built,
  # catalog declared — STILL ran 9 rounds without executing until manager set .halt. The checker's
  # registry lists each behavior → redReading and mechanically verifies the reading is declared in
  # tracked files (not self-asserted); removing a red-reading declaration exits 1 (uncov>0), so a
  # regression in execution-guarantee wiring red-lights the commit. The three ## Contract invariants
  # are a15_ruling5 / scope_worktree_gate / ruling5_status (must be covered).
  # @static-tier change
  # @static-object orchestration/orchestrator-tick-core.md plugin/scripts/red-on-omission-audit.ts plugin/test/red-on-omission-audit.test.mjs
  run_checker "red-on-omission-audit" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/red-on-omission-audit.ts" --root "${repo_root}"
  echo "== tick-core static check (gap-tick-core-zero-static-coverage, AC2-AC7) =="
  # The execution-core static gate: the three *-tick-core.md files (what the three layers ACTUALLY
  # read every tick, the AC30(a) judgment objects) had ZERO static coverage — @static-object pointed
  # at the *-loop-tick.md REASON archives, not the *-tick-core.md EXECUTION cores (grep -c "tick-core"
  # in this file was 0; §1.4e's "换实现要同步换判据,否则『检查通过』检查的是一个已经不存在的东西").
  # Four 2026-08-10 incidents were all hand-found with wc -l / grep, zero mechanical gate:
  #   ① AC30(a) ≤80 lines per core  ② pointer target files exist  ③ criterion numbering (①-⑤)
  #      must not collide with the B3 group (甲乙丙丁戊)  ④ prohibition docs ("不要自己用 Agent /
  #      外层不直接改代码") must be consistent with the cores' run_in_background dispatch — an
  #      unconditional prohibition reddens; the 收窄/单一写入者/共享树 narrowing passes.
  # @static-tier always
  # @static-object orchestration/manager-tick-core.md orchestration/orchestrator-tick-core.md orchestration/fast-mode-tick-core.md orchestration/outer-brief-2026-08-04-third-restart.md orchestration/QUAY-OUTER-HANDOFF.md orchestration/exp6-phase1-sustained-unattended-operation.md plugin/loop/orchestrator-loop-tick.md plugin/scripts/tick-core-static-check.ts plugin/test/tick-core-static-check.test.mjs
  run_checker "tick-core-static-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/tick-core-static-check.ts" --root "${repo_root}"
  echo "== instrument-failure check (gap-manager-instrument-failures-need-mechanical-detection-not-carefulness, AC3) =="
  # The manager instrument-failure five-family detector (FAMILY-1..5 in the checker header). The
  # manager's instrument failures recurred 7× in one night across five families already documented
  # in manager-loop-tick.md §4 — prose rules provably don't work, so the five families get a
  # MECHANICAL detection path (the ## Contract's `detected_families ≥ 5` band as an executable
  # invariant, AC5: §4 prose → scan surface). Gate semantics (exit 1 = red):
  #   band        — every family must fire ≥1 time on the default tick-doc surface; a §4 family
  #                 that is no longer mechanically detectable red-lights the commit.
  #   shrink-only — every family's hit count must stay ≤ FAMILY_BASELINE[n]; a NEW failure-form
  #                 instance beyond the documented baseline red-lights (prose can't silently add
  #                 another un-detected failure shape).
  # The AC2 per-family positive/negative controls live in
  # plugin/test/instrument-failure-check.test.mjs + the mutation case (correct form 0 hits, error
  # form must report).
  # @static-tier change
  # @static-object orchestration/manager-loop-tick.md plugin/loop/fast-mode-loop-tick.md plugin/loop/manager-loop-tick.md plugin/loop/orchestrator-loop-tick.md
  run_checker "instrument-failure-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/instrument-failure-check.ts" --gate --root "${repo_root}"
  echo "== obligation-ledger check (gap-obligation-ledger-mechanization, AC2-AC5 top-level audit) =="
  # The obligation-ledger integrity audit — the top-level audit the known weakness demands ("台账由
  # 本层写、上层审；顶层审计 = 人 + 接进套件静态检查的机械核对"). Mechanically verifies on the
  # checked ledger: (1) obligation_set_derived=1 — every obligation id equals the deterministic
  # derivation of its generator key (a hand-written id is the "作者写义务集" shape); (2) band — age
  # is monotonic across consecutive live rounds (never drops, never jumps); (3)
  # round_cannot_close_with_undischarged=1 — a round recorded canClose:true while a live+undischarged
  # obligation exists is the 强行闭轮 shape and red-lights the commit. Fail-open on an ABSENT ledger
  # (mechanism not yet adopted); fail-closed on a present one.
  # @static-tier change
  # @static-object plugin/scripts/obligation-ledger.ts plugin/scripts/obligation-ledger-check.ts plugin/scripts/obligation-discharge-agent.ts plugin/test/obligation-ledger.test.mjs plugin/test/obligation-ledger-check.test.mjs
  run_checker "obligation-ledger-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/obligation-ledger-check.ts" --root "${repo_root}"
  echo "== delivery-inventory drift gate (gap-delivery-inventory-drift-needs-file-add-gate, AC2) =="
  # The file-set change gate on the delivery-inventory snapshot (candidate B): `--diff-filter=AD` on plugin/scripts/ — git committed range + working-tree staged/unstaged/untracked — is the ONLY
  # trigger; when it fires, the SAME change set must update docs/proposals/quay-product-outline.md
  # §6 (the derived DELIVERY-INVENTORY snapshot). Content-only edits to existing scripts do NOT
  # trigger (invariant content_only_change_skipped = 1). FAIL-closed: a plugin/scripts A/D without
  # an outline update exits 1. 2026-08-10 red family (r216/r222/r223/r226/r248/r253) fixed at the
  # root cause (7d2faf06 fixed the symptom only).
  # @static-tier change
  # @static-object plugin/scripts/ docs/proposals/quay-product-outline.md
  run_checker "delivery-inventory-drift-gate" bash "${repo_root}/plugin/scripts/delivery-inventory-drift-gate.sh" --root "${repo_root}"
  echo "== checker-mutation check (gap-checkers-have-never-been-shown-to-fail, AC1-AC6) =="
  # The L_S instrument: mutation-test the checkers THEMSELVES, not product code. The manifest is
  # parsed from THIS function + CI (never hand-written), so a checker added here (or to a CI
  # workflow) appears in the manifest automatically and, until it gets a mutation case in
  # plugin/scripts/checker-mutation-cases/, this gate FAILS — "a new checker with no mutation
  # case" can never silently slip through (AC1b). --check runs every registered checker's
  # mutation case (inject the defect it claims to catch → the checker MUST go red; restore →
  # green) plus the two AC5 regression cases (the #6 zero-dependency-probe rename control and
  # the #10 activity-present-telemetry-empty /live direction). `mutations_that_stayed_green`
  # must be 0 (AC3), and the mechanism also mutates itself (AC4, --selftest).
  # @static-tier full  (the ~13s meta-check on the checkers THEMSELVES — deferred to the full-suite gate)
  run_checker "checker-mutation-check" bash "${repo_root}/plugin/scripts/checker-mutation-check.sh" --check
  # Wait for all parallelized checkers and fail closed if any failed (see the RUN_CHECKER_PARALLEL
  # note at the top of this function — AC3 failure visibility, AC4 cost-ledger completeness).
  run_checker_parallel_wait
}

# run_scoped_static_checks — the change-relevant static-check TIER for SCOPED task runs
# (gap-scoped-runs-pay-full-static-check-overhead, AC1/AC3/AC6). A per-task scoped run used to pay
# the FULL run_static_checks fixed overhead (~16s, ~13s of it checker-mutation-check) even when it
# ran 1-2 test files. Scoped mode runs ONLY the checkers whose object intersects the task's
# `## Touches` (e.g. test-framework-policy/isolation when a test file is touched, the doc/shell
# ratchets when their objects are touched) PLUS the always-relevant ## Contract consumer on the
# TOUCHED task files (AC1's exemplar — it has already caught 7 Contract violations), SKIPPING
# checker-mutation-check and the unrelated repo-level ratchets.
#
# The FULL set is byte-unchanged in run_static_checks above (AC2 — the full-suite gate is NOT
# weakened: the outer verification round still runs every checker every time). A scoped skip is
# DEFERRED to the full-suite gate, never dropped (AC4-ii: an unrelated repo-level ratchet violation
# is not caught by the scoped run and MUST be caught by the full run). The touch→checker relevance
# mapping is MECHANICAL (select-static-checks-for-touches.ts parses the `# @static-tier` /
# `# @static-object` annotations in run_static_checks — the SAME single source checker-mutation-check.sh
# parses; never a hand-maintained list, AC3).
run_scoped_static_checks_sel() {
  # "$@" = --task <id> OR --touches <csv>
  if [ "${QUAY_TEST_NESTED:-}" = "1" ] && [ "${QUAY_TEST_NESTED_ROOT:-}" = "${repo_root}" ]; then
    echo "scripts/test.sh: QUAY_TEST_NESTED=1 — skipping scoped static checks (nested invocation; outer suite ran them)"
    return 0
  fi
  if [ "${QUAY_TEST_SKIP_STATIC_CHECKS:-}" = "1" ]; then
    echo "scripts/test.sh: QUAY_TEST_SKIP_STATIC_CHECKS=1 — skipping scoped static checks (nested 0-match/smoke run; outer suite ran them)"
    return 0
  fi
  echo "== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) =="
  local cmds
  if ! cmds="$(node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/select-static-checks-for-touches.ts" --root "${repo_root}" "$@" --commands 2>&1)"; then
    echo "scripts/test.sh: scoped static-check selection FAILED — not silently skipping the gate" >&2
    exit 1
  fi
  if [ -z "${cmds}" ]; then
    echo "scripts/test.sh: scoped static checks — no change-relevant checkers selected (deferred to the full-suite gate)"
    return 0
  fi
  local cmd
  while IFS= read -r cmd; do
    [ -n "${cmd}" ] || continue
    echo "  scoped check: ${cmd}"
    eval "${cmd}"
  done <<< "${cmds}"
}
run_scoped_static_checks() { run_scoped_static_checks_sel --task "$1"; }
run_scoped_static_checks_touches() { run_scoped_static_checks_sel --touches "$1"; }

# ── derived default concurrency (gap-no-resource-awareness-heavy-ops-run-blind, AC5) ──────────────
# node --test with concurrency N actually runs ~N × AMPLIFICATION node processes: each worker
# spawns its own subprocesses. Measured 2026-08-03: a full suite at concurrency 8 peaked at
# 17 node processes ⇒ ratio ≈ 2.125; a scoped concurrency-2 run of subprocess-heavy plugin tests
# re-measured 3.0 per worker. The derived default:
#   default = max(1, floor(nproc / AMPLIFICATION))
# AMPLIFICATION = 1.0 since the AC5 cost-side experiment finally ran
# (gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible, 2026-08-08): the same
# selected set (6 subprocess-heavy plugin test files, 86 tests) at concurrency 1/4/8 gave
#   c1: 57.5s wall, 0 cancelled · c4: 24.1s, 0 cancelled · c8: 27.3s, 0 cancelled
# — CANCELLED dimension: zero cancelled at 4 AND 8 refutes "lower concurrency to avoid cancel".
#   Wall-clock is a SEPARATE axis (this selected set: c4 fastest; outer's full-suite laneCount-8
#   rounds wall-clock faster than lane 4, −22%~−40% directional, 2026-08-08) — the derivation is
#   justified by the cancelled dimension, NOT "nproc = the wall-clock sweet spot" (split per
#   gap-claude-md-nproc-wallclock-claim-scope-correction). The old 2.1 amplification (which on this box gave 1, a
# definite ~2.4× wall-clock penalty) was an unproven-conservative guard against oversubscription;
# the cost side was never measured until now. On this box the default is now floor(4/1.0) = 4.
#
# CROSS-LAYER TOTAL BUDGET (gap-test-concurrency-cap-does-not-scope-nested-spawns AC1/AC4): the
# derivation is budget-aware — default = max(1, floor((total_budget − in_use) / AMPLIFICATION)),
# where total_budget = nproc (the cross-layer authority, plugin/scripts/process-budget.sh) and
# in_use = node-MainThread processes ALREADY running across all worktrees. When the machine is idle
# (in_use = 0) this is exactly the nproc sweet spot above. When another worktree / a nested spawn is
# already consuming node processes, this worker derives a SMALLER concurrency so the TOTAL across all
# layers stays ≤ total_budget — nested spawns (quay-init family / session family) can no longer
# multiply beyond the cap (the 17-19 procs / load 18.70 defect).
#
# REVERT HISTORY (single source of truth — gap-concurrency-derivation-reverted-but-doc-ac-and-tests-
# all-still-report-derived): the derived default was TEMPORARILY pinned back to 8 and then restored.
#   - 2026-08-03 (623d662b, outer urgent correction): pinned default_test_concurrency back to 8. The
#     derived default of 1 turned every full suite from ~8 min to ~55 min (Σ ≈ 3300s at concurrency 1
#     vs 460-570s wall at 8). AC5's tradeoff experiment never ran: the amplification side (17/8 =
#     2.125) was measured but NOT the cost side. sigma measured Σ/wall ≈ 7.1 at 8 lanes (saturated,
#     not overloaded); "lower concurrency to avoid cancel" was unproven, the cost of lowering was a
#     definite ~7×. The pin was EXPLICITLY temporary ("REVERT this override once AC5's tradeoff
#     experiment is run").
#   - 2026-08-06 (gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived):
#     REVERTED the pin — restored the derived formula. The drift being fixed: docs/ACs/tests all
#     reported the derived form while the code returned a constant, and the unreachable call made
#     default_concurrency_formula a dead organ. Reconciliation direction = "make reality catch up to
#     claims": the derived formula IS the AC5 deliverable; the revert was a temporary override that
#     never got its experiment. The cost side is already handled — ci.yml passes the EXPLICIT
#     escape hatch (`--test-concurrency=N`, pinned there for the 10-min budget), so the derived
#     default only governs LOCAL default runs, and full-suite-runner.ts already derives laneCount
#     from nproc.
#   - 2026-08-08 (gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible AC1/AC3):
#     the AC5 cost-side experiment ran (see above) — zero cancelled at concurrency 4 AND 8, so the
#     "avoid cancel" guard that justified AMPLIFICATION=2.1 (default 1 on 4 cores) is refuted.
#     AMPLIFICATION lowered 2.1 → 1.0: the derived default is now nproc (4 on this box). The outer
#     full-suite runner already verified at laneCount 8 with cancelled 0 across 13+ rounds
#     (2026-08-08, .quay/verification-round.jsonl) — the oversubscription cost side never produced
#     a cancelled/fail. The cross-layer TOTAL process budget is the responsibility of
#     gap-test-concurrency-cap-does-not-scope-nested-spawns (AC4 cross-annotation), NOT this
#     single-layer default.
# An EXPLICIT --test-concurrency=N on the command line ALWAYS overrides (node --test is
# last-flag-wins, and the user's flag is passed AFTER the default in the exec line).
#
# Test seams (unit test in plugin/test/resource-gate.test.mjs): RESOURCE_GATE_NPROC /
# RESOURCE_GATE_AMPLIFICATION / RESOURCE_GATE_TEST_NODE_PROCS override the derivation inputs
# deterministically (the last is the budget `in_use` — the cross-layer total-budget subtraction).
default_concurrency_formula() {
  local total_budget in_use amp
  amp="${RESOURCE_GATE_AMPLIFICATION:-1.0}"
  # CROSS-LAYER TOTAL BUDGET (gap-test-concurrency-cap-does-not-scope-nested-spawns AC1): the
  # worker derivation reads the SHARED budget authority (process-budget.sh — the same gate
  # cap-from-gate.ts and resource-gate.sh read), not a per-layer nproc derivation. The budget is
  # `nproc` total node --test processes across ALL worktrees; `in_use` = node-MainThread procs
  # already running. default = max(1, floor((total_budget − in_use) / AMPLIFICATION)) so nested
  # spawns (quay-init / session family) count against the SAME total instead of each worker
  # deriving its own cap and multiplying beyond it (the 17-19 procs / load 18.70 defect).
  # The RESOURCE_GATE_NPROC / RESOURCE_GATE_TEST_NODE_PROCS seams override the read
  # deterministically in tests (resource-gate.test.mjs extracts this function body and runs it
  # standalone, so the shell-out must be skippable when both seams are set).
  total_budget="${RESOURCE_GATE_NPROC:-}"
  in_use="${RESOURCE_GATE_TEST_NODE_PROCS:-}"
  if [ -z "${total_budget}" ] || [ -z "${in_use}" ]; then
    local budget_out
    budget_out="$(bash "${repo_root}/plugin/scripts/process-budget.sh" 2>/dev/null || true)"
    if [ -z "${total_budget}" ]; then
      total_budget="$(printf '%s\n' "${budget_out}" | sed -n 's/^total_budget=//p')"
    fi
    if [ -z "${in_use}" ]; then
      in_use="$(printf '%s\n' "${budget_out}" | sed -n 's/^in_use=//p')"
    fi
  fi
  total_budget="${total_budget:-$(nproc 2>/dev/null || echo 1)}"
  in_use="${in_use:-0}"
  awk -v b="${total_budget}" -v u="${in_use}" -v a="${amp}" 'BEGIN { c = int((b - u) / a); if (c < 1) c = 1; print c }'
}

default_test_concurrency() {
  default_concurrency_formula
}

# ── load-sensitive phase concurrency knobs (gap-load-sensitive-serial-phase-unbounded-growth-
# measure-first AC2/AC3, measure-first) ─────────────────────────────────────────────────────────────
# The serial phase (KNOWN-LOAD-SENSITIVE A/B-class + real-install family) runs at concurrency
# SERIAL_CONCURRENCY (default 2, raised from 1 by the AC2 controlled experiment — see the task body)
# and the lowconc phase (hermetic-but-load-sensitive session-observation family) at LOWCONC_CONCURRENCY
# (default 3). Both are env-overridable (QUAY_SERIAL_CONCURRENCY / QUAY_LOWCONC_CONCURRENCY) so a
# future controlled experiment can re-measure before the next bump — the measure-first rule
# (gap-suite-cost-model-is-wrong-optimizations-buy-nothing: 墙钟差异落 17-63s 噪声带).
# EXPERIMENT (2026-08-10, task body): A/B-class load-sensitive serial 子集 6 文件
#   cc=1 WALL_MS=455613 (0 cancelled) vs cc=2 WALL_MS=289579 (0 cancelled) — c2 快 36% 且 0-cancelled;
#   real-install e2e 双文件 c2 实测 0-cancelled (147s)。⇒ 默认上调至 2。
# The full-suite-runner sets these env vars when --serial-concurrency / --lowconc-concurrency are passed.
SERIAL_CONCURRENCY="${QUAY_SERIAL_CONCURRENCY:-2}"
LOWCONC_CONCURRENCY="${QUAY_LOWCONC_CONCURRENCY:-3}"

# has_explicit_concurrency <args...> — whether the args already carry a --test-concurrency flag
# (either the `=` spelling with a numeric value, or the SPACE spelling with a numeric value). When it
# does, the derived default MUST NOT be prepended: an explicit flag is the SINGLE concurrency source.
# This is what makes the full-suite-runner's REPLACE splice produce EXACTLY ONE --test-concurrency on
# the node --test process (gap-full-suite-runner-concurrency-default-and-gate AC2; the ps-level
# Contract measure `grep -o -- '--test-concurrency=[0-9]*' | wc -l` must read 1). Without this, the
# runner's spliced value and test.sh's own default would coexist as TWO flags — the ABORT #5 shape.
has_explicit_concurrency() {
  local prev="" a
  for a in "$@"; do
    case "$a" in
      --test-concurrency=*|--test-concurrency) return 0 ;;
    esac
    if [ "$prev" = "--test-concurrency" ]; then return 0; fi
    prev="$a"
  done
  return 1
}

# resource_gate_check — consult the shared resource gate BEFORE a FULL-SUITE (glob-based default)
# run (gap-no-resource-awareness-heavy-ops-run-blind, AC7). WAIT → the gate printed the numbers,
# this exits non-zero — NEVER silently wait (silent wait is indistinguishable from a hang).
# Scoped paths (explicit files, --for-task, non-default --group) skip the gate — they are the
# verification path that must stay usable under load. QUAY_TEST_SKIP_RESOURCE_GATE=1 is the
# test-only escape for a nested runner invoked inside an outer suite.
resource_gate_check() {
  if [ "${QUAY_TEST_SKIP_RESOURCE_GATE:-}" = "1" ]; then
    echo "scripts/test.sh: QUAY_TEST_SKIP_RESOURCE_GATE=1 — skipping resource gate (nested runner)"
    return 0
  fi
  echo "== resource gate (gap-no-resource-awareness-heavy-ops-run-blind) =="
  if ! bash "${repo_root}/plugin/scripts/resource-gate.sh" --for full-suite; then
    echo "scripts/test.sh: resource gate says WAIT — not running the full suite (numbers above). Re-run when the gate reports GO." >&2
    exit 1
  fi
}

# ── single-flight lock (gap-resource-gate-no-single-flight-lock-two-suite-overlap) ──────────────────
# full_suite_lock — an exclusive flock on a SHARED lock file (default <git-common-dir>/full-suite.lock;
# see the path resolution below), held for the ENTIRE full-suite run. COMPLEMENTARY to the resource
# gate: the gate prevents "starting into a busy machine" (a load check at startup), the lock prevents
# "a second suite joining" (mutual exclusion). Together they are complete — two full suites can no
# longer both see GO in a low-load window and start (the 2026-08-07 incident: two cc8 suites ran
# simultaneously in DIFFERENT worktrees, 16 workers + subprocesses on 4 cores, PSI cpu avg10 = 86.22).
#
# The lock is file-descriptor-based (flock(1) on FD 9): the FD is opened once and held open for the
# whole run, so the lock releases automatically when this process exits — even on an error abort —
# with no trap bookkeeping. A second concurrent full-suite startup BLOCKS on flock (WAIT/queue) for
# up to FULL_SUITE_LOCK_TIMEOUT (default 600s), then FAILS CLOSED with a clear message — never both
# GO, never an infinite hang.
#
# Scoped paths (--for-task, --scoped, --group <non-default>, explicit files) never take the lock —
# they are the verification path that must stay usable while a full suite runs. Nested runners skip
# via the SAME escape hatch the resource gate uses (QUAY_TEST_SKIP_RESOURCE_GATE=1) plus the
# same-root QUAY_TEST_NESTED guard (a nested test.sh spawned inside the running suite must not
# deadlock against the suite's own lock).
# SHARED lock file: resolve via git's COMMON dir so every worktree of this repo AND the primary
# checkout contend on the SAME lock — the 2026-08-07 incident was two DIFFERENT worktrees each
# running a cc8 suite, and a per-checkout `.quay/full-suite.lock` would NOT have serialized them.
# git-common-dir resolves to the main repo's `.git` from any worktree, so
# `<git-common-dir>/full-suite.lock` is the same inode everywhere. Fall back to
# `<repo_root>/.quay/full-suite.lock` when git is unavailable (a non-git copy).
FULL_SUITE_LOCK_DIR="$(git rev-parse --git-common-dir 2>/dev/null || true)"
if [ -z "${FULL_SUITE_LOCK_DIR}" ]; then
  FULL_SUITE_LOCK_DIR="${repo_root}/.git"
fi
FULL_SUITE_LOCK_FILE="${FULL_SUITE_LOCK_FILE:-${FULL_SUITE_LOCK_DIR}/full-suite.lock}"
FULL_SUITE_LOCK_FD=9
FULL_SUITE_LOCK_TIMEOUT="${FULL_SUITE_LOCK_TIMEOUT:-600}"

# full_suite_lock_acquire — acquire the single-flight lock (blocking wait up to the timeout).
full_suite_lock_acquire() {
  if [ "${QUAY_TEST_SKIP_RESOURCE_GATE:-}" = "1" ]; then
    echo "scripts/test.sh: QUAY_TEST_SKIP_RESOURCE_GATE=1 — skipping single-flight lock (nested runner)"
    return 0
  fi
  if [ "${QUAY_TEST_NESTED:-}" = "1" ] && [ "${QUAY_TEST_NESTED_ROOT:-}" = "${repo_root}" ]; then
    echo "scripts/test.sh: QUAY_TEST_NESTED=1 — skipping single-flight lock (nested invocation of the same suite)"
    return 0
  fi
  mkdir -p "$(dirname "${FULL_SUITE_LOCK_FILE}")"
  # Open the lock file on a dedicated FD (append mode: the file exists + is writable even if empty).
  eval "exec ${FULL_SUITE_LOCK_FD}>${FULL_SUITE_LOCK_FILE}"
  echo "== single-flight lock (gap-resource-gate-no-single-flight-lock-two-suite-overlap) =="
  if ! flock -w "${FULL_SUITE_LOCK_TIMEOUT}" "${FULL_SUITE_LOCK_FD}"; then
    echo "scripts/test.sh: another full suite holds ${FULL_SUITE_LOCK_FILE} — not starting (single-flight lock; waited ${FULL_SUITE_LOCK_TIMEOUT}s). Re-run when it finishes." >&2
    exit 1
  fi
  echo "scripts/test.sh: acquired full-suite single-flight lock (${FULL_SUITE_LOCK_FILE}) — held for the entire run"
}

# full_suite_lock_release — release the single-flight lock (idempotent; also auto-released on exit).
full_suite_lock_release() {
  flock -u "${FULL_SUITE_LOCK_FD}" 2>/dev/null || true
  eval "exec ${FULL_SUITE_LOCK_FD}>&-" 2>/dev/null || true
}

# ── group resolution helpers (gap-test-suite-has-no-layer-grouping) ──────────────────────────────

# group_of <file> — echo the declared `// @test-group <name>` (default: engine, AC7).
# Valid groups: product|engine|governance (the default-run body) + serial (the load-sensitive
# concurrency-1 phase — nested-suite-spawn + real-wall-clock-wait + the real-install
# install/quay-init family, gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests +
# gap-install-family-tests-rotate-flakes-under-full-suite) + lowconc (the hermetic-but-load-sensitive
# concurrency-3 phase, gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive). A MISSING
# declaration defaults to
# engine (AC7). An UNRECOGNIZED group name is FAIL-CLOSED, never silently degraded to engine:
# the r10 regression (four commits b209f4fd→174badc0→e92c54d8→c7176a37 each dropping one group
# from this case, so serial/lowconc silently folded into the concurrency-N body and the isolation
# guarantee was cancelled WITHOUT going red) must be a hard failure, not a silent pass.
group_of() {
  local f="$1" g
  g="$(grep -m1 -oE '@test-group[[:space:]]+[a-z]+' "$f" 2>/dev/null | awk '{print $2}' || true)"
  case "${g:-}" in
    product|engine|governance|serial|lowconc) echo "$g" ;;
    "")
      # No declaration at all — intentional default to engine (AC7). The undeclared → engine path
      # is a real rule, distinct from an unknown-group typo.
      echo "engine" ;;
    *)
      echo "scripts/test.sh: group_of: FAIL-CLOSED: '$f' declares unknown @test-group '$g' — a group was dropped or mis-typed (recognized: product|engine|governance|serial|lowconc); refusing to silently degrade it to engine" >&2
      exit 3
      ;;
  esac
}

# check_group_declarations — pre-flight fail-closed guard (gap-verify-round-9-failures-from-recent-
# changes-fix-batch, AC0b): every test file's declared `// @test-group` must be one of the five
# recognized groups. A file declaring an UNKNOWN group is a dropped/mis-typed group — the r10
# regression (b209f4fd→174badc0→e92c54d8→c7176a37 each dropping one group from group_of's case)
# silently folded serial/lowconc into the concurrency-N engine body and cancelled the isolation
# guarantee WITHOUT going red. That must be a HARD failure, not a silent pass. group_of's own
# `*)` branch is defense-in-depth (it runs inside a command substitution, so its exit cannot abort
# the parent); this check runs directly in the dispatch path and exits the script.
check_group_declarations() {
  local f g
  while IFS= read -r f; do
    g="$(grep -m1 -oE '@test-group[[:space:]]+[a-z]+' "$f" 2>/dev/null | awk '{print $2}' || true)"
    case "${g:-}" in
      ""|product|engine|governance|serial|lowconc) ;;
      *)
        echo "scripts/test.sh: FAIL-CLOSED: '$f' declares unknown @test-group '$g' — a group was dropped or mis-typed (recognized: product|engine|governance|serial|lowconc); refusing to silently degrade it to engine" >&2
        exit 3
        ;;
    esac
  done < <(build_deduped_files)
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

# list_groups — per-group counts over the full deduped glob (AC10). `serial` and `lowconc` are real
# groups (the load-sensitive families routed to their own phases), so the default-set partition
# product+engine+governance no longer equals total — serial and lowconc are the 4th and 5th parts.
list_groups() {
  declare -A counts=([product]=0 [engine]=0 [governance]=0 [serial]=0 [lowconc]=0)
  local f g
  while IFS= read -r f; do
    g="$(group_of "$f")"
    counts[$g]=$(( ${counts[$g]:-0} + 1 ))
  done < <(build_deduped_files)
  printf 'product:    %d\n' "${counts[product]:-0}"
  printf 'engine:     %d\n' "${counts[engine]:-0}"
  printf 'governance: %d\n' "${counts[governance]:-0}"
  printf 'serial:     %d\n' "${counts[serial]:-0}"
  printf 'lowconc:    %d\n' "${counts[lowconc]:-0}"
  local total=$(( ${counts[product]:-0} + ${counts[engine]:-0} + ${counts[governance]:-0} + ${counts[serial]:-0} + ${counts[lowconc]:-0} ))
  printf 'total:      %d (deduped by realpath)\n' "$total"
}

# build_dist_once — build dist/quay.js ONCE per invocation, before any test runs
# (gap-tests-spawn-cli-from-ts-source, AC5). cli-entry.mjs
# (packages/quay/test/helpers/cli-entry.mjs) routes CLI-spawning tests through the
# prebuilt bundle when present AND fresh; a missing/stale bundle silently falling
# back to the slow .ts path — or, worse, silently passing tests over old code — is
# the failure mode AC5 exists to make impossible. Build failure is FATAL: never
# run tests against a bundle whose freshness we cannot guarantee.
#
# NESTED-RUN ESCAPE HATCH (gap-ac11-spawns-the-runner-inside-the-runner): a test
# that spawns scripts/test.sh INSIDE the suite (select-tests-for-touches AC10/AC11)
# must not rebuild the dist bundle — a rebuild is pure redundant cost (2 esbuilds +
# a vendor mirror) that makes the inner run's success depend on the outer's CPU load
# (measured 2026-08-03: 3.7s isolated → 9-16s under an 8-way suite + sibling batches).
# QUAY_TEST_SKIP_DIST_BUILD=1 is set ONLY by nested invocations whose tests never
# consume the bundle (0-match or pure-selector runs); skipping can never test stale
# code because those runs never read dist at all, and the freshness gate (cli-entry.mjs
# mtime check / sync-vendor --check) still guards every real bundle consumer. A
# standalone test.sh that sets this is explicitly vouching for bundle freshness, so it
# skips the gate (never set it in CI or the outer loop). NOTE: runner-grouping.test.mjs
# does not set it either, but its nested runs now inherit QUAY_TEST_NESTED from the outer
# suite's mark_nested() and skip the rebuild automatically (gap-suite-speed-under-a-297-
# second-sigma). The build is still exercised ONCE per real suite (the outer invocation),
# so the freshness gate keeps its guard; the runner-grouping nested runs only ever run
# --group subsets / fixtures and re-running 2 esbuilds + vendor mirror inside each was the
# measured redundant cost this skip removes.
build_dist_once() {
  # QUAY_TEST_NESTED — see run_static_checks(): a nested invocation (a test spawning scripts/test.sh)
  # inherits the marker and skips the rebuild the OUTER suite already did at its start
  # (gap-suite-speed-under-a-297-second-sigma). Same-root guard keeps a different-worktree nested
  # run building its own bundle.
  if [ "${QUAY_TEST_NESTED:-}" = "1" ] && [ "${QUAY_TEST_NESTED_ROOT:-}" = "${repo_root}" ]; then
    echo "scripts/test.sh: QUAY_TEST_NESTED=1 — skipping dist rebuild (nested invocation; outer suite built it)"
    return 0
  fi
  if [ "${QUAY_TEST_SKIP_DIST_BUILD:-}" = "1" ]; then
    echo "scripts/test.sh: QUAY_TEST_SKIP_DIST_BUILD=1 — skipping dist rebuild (outer runner built it)"
    return 0
  fi
  # Core bundle first (the critical path — cli.test.mjs routes through QUAY_CLI).
  echo "== build dist/quay.js (packages/quay/scripts/build-dist.mjs) =="
  if ! node "${repo_root}/packages/quay/scripts/build-dist.mjs"; then
    echo "scripts/test.sh: core dist build FAILED — refusing to run tests against a possibly-stale bundle" >&2
    exit 1
  fi
  # Native provider bundle too: QUAY_NATIVE_CLI (cli-entry.mjs) resolves to it
  # for the AC9 conversions (serve.test.mjs / mcp-server.test.mjs use the native
  # CLI to seed fixtures). A missing native bundle would silently fall back to
  # the slow .ts path with a MISSING warning on every test process.
  echo "== build dist/quay-native.js (packages/quay-native/scripts/build-dist.mjs) =="
  if ! node "${repo_root}/packages/quay-native/scripts/build-dist.mjs"; then
    echo "scripts/test.sh: native dist build FAILED — refusing to run tests against a possibly-stale bundle" >&2
    exit 1
  fi
  # gap-sync-vendor-drift-mislabelled-as-task-schema (M136): the vendored plugin
  # dist (plugin/vendor/quay/dist/quay.js) is a gitignored GENERATED mirror
  # consumed live by the plugin's MCP server (plugin/.mcp.json). Rebuilding the
  # SOURCE dist above without re-mirroring it made sync-vendor.sh --check fail
  # DETERMINISTICALLY on every suite (a newer source build vs an untouched
  # vendored copy) while its DRIFT message mislabeled the compared file — the
  # root cause of M136 being read as "flaky" for three rounds. The chosen sync
  # timing (documented in plugin/scripts/sync-vendor.sh's header comment) is
  # "auto-sync with tests": mirror the just-built source bundle to the vendored
  # copy now (no rebuild) so --check sees a consistent mirror. Fails loudly —
  # a broken mirror must never be silently papered over.
  echo "== mirror vendored plugin dist (plugin/scripts/sync-vendor.sh --sync-dist) =="
  if ! bash "${repo_root}/plugin/scripts/sync-vendor.sh" --sync-dist; then
    echo "scripts/test.sh: vendored dist mirror FAILED — refusing to run tests against a possibly-stale plugin bundle" >&2
    exit 1
  fi
}

# mark_nested — mark THIS invocation as the outer runner so any scripts/test.sh that a TEST spawns
# (a nested invocation) can detect it is nested and skip the redundant dist rebuild + whole-store
# static checks that the OUTER suite already ran at its start (gap-suite-speed-under-a-297-second-sigma).
# The marker is set ONLY at the exec-to-node boundary (right before each `node --test` below), never
# at the top of this script: the OUTER invocation must NOT skip its own setup. A nested invocation
# inherits QUAY_TEST_NESTED/QUAY_TEST_NESTED_ROOT through its env, and the QUAY_TEST_NESTED check at
# the top of build_dist_once()/run_static_checks() skips the redundant work. QUAY_TEST_NESTED_ROOT
# carries the OUTER's repo_root so a nested run in a DIFFERENT worktree (a genuinely different repo
# state) does not skip the checks it needs.
mark_nested() {
  export QUAY_TEST_NESTED=1
  export QUAY_TEST_NESTED_ROOT="$repo_root"
}

# run_selected <groups-csv> [extra-node-flags...] — build the selected file list and exec node
# --test. Runs the split-or-commit whole-store scan first (same invariant as the default/no-args
# path). Extra flags (from the flags-only form) are PREPENDED to the file list; node --test is
# last-flag-wins, so a user --test-concurrency=N still overrides the derived default.
# ── Fixed-overhead instrumentation (gap-suite-fixed-overhead-decomposition, AC1/AC2) ───────────────
# The ~152s fixed overhead (build_dist_once / run_static_checks / resource-gate / inter-phase gaps)
# was never decomposed. These segments are DETERMINISTIC SERIAL — no concurrency jitter — so direct
# per-segment timestamps give a decidable number (unlike wall-clock diffs, which sit inside the
# 17–63s noise band per gap-suite-cost-model-is-wrong-optimizations-buy-nothing). We record epoch-ms
# at each serial boundary and emit a per-segment breakdown to stderr on the FULL-SUITE default path.
# Only the default (product,engine) full-suite path emits it — scoped --group runs skip (their fixed
# overhead is not the object of measurement). Output lines: `__OVERHEAD__ <segment>_ms=<N>`.
_oh_mark() { date +%s%N | cut -c1-13; }
_oh_emit() { # _oh_emit <label> <start_ms> <end_ms>  → __OVERHEAD__ label_ms=N
  # uutils date doesn't truncate %3N (returns epoch+full-9-digit-ns), so we slice epoch-ms
  # from +%s%N. Guard: an empty/absent mark emits 0 rather than garbage (a mark capture that
  # raced a subshell must not corrupt the whole breakdown).
  local label="$1" s="$2" e="$3"
  if [ -z "$s" ] || [ -z "$e" ] || ! [[ "$s" =~ ^[0-9]+$ ]] || ! [[ "$e" =~ ^[0-9]+$ ]]; then
    echo "__OVERHEAD__ ${label}_ms=ERR-UNSET" >&2
    return
  fi
  echo "__OVERHEAD__ ${label}_ms=$((e - s))" >&2
}

# ── Partial-overhead fallback (gap-red-round-loses-overhead-phase-decomposition AC2/AC3) ──────────
# The full 9-segment emit below runs ONLY after the main phase completes — a kill-on-red truncation
# (runner red-grace / max-runtime SIGTERM to the whole process tree) therefore historically left a
# red round's archived log with ZERO __OVERHEAD__ lines even though serial/lowconc HAD completed.
# Two fixes make the red round measurable: (1) the runner tees stderr to the archive too (the
# __OVERHEAD__ lines ARE captured — locked by a regression test in full-suite-runner.test.mjs), and
# (2) THIS fallback: a SIGTERM/EXIT trap emits the COMPLETED segments (partial=1) on the truncation
# path, so serial/lowconc reach the log before the kill completes; un-run phases stay absent (缺省).
_oh_done=0  # 1 once the full emit OR the partial fallback ran — suppresses SIGTERM→EXIT double-emit

_oh_emit_p() { # _oh_emit_p <label> <start_ms> <end_ms> → __OVERHEAD__ label_ms=N partial=1 (skip if unset)
  local label="$1" s="$2" e="$3"
  # An un-run segment (e.g. main truncated) has an empty bound → 缺省: ABSENT, not ERR-UNSET, so a
  # truncated round is distinguishable from a genuinely broken one.
  if [ -z "$s" ] || [ -z "$e" ] || ! [[ "$s" =~ ^[0-9]+$ ]] || ! [[ "$e" =~ ^[0-9]+$ ]]; then
    return 0
  fi
  echo "__OVERHEAD__ ${label}_ms=$((e - s)) partial=1" >&2
}

_oh_emit_partial() {
  # Truncation-path fallback: emit the COMPLETED segments with partial=1. No-op on a scoped run
  # (oh_full=0) or once the full emit already ran (_oh_done=1). Missing bounds are skipped (缺省).
  [ "${oh_full:-0}" -eq 1 ] || return 0
  [ "${_oh_done:-0}" -eq 0 ] || return 0
  _oh_done=1
  _oh_emit_p "lock_overhead"             "$oh_t0" "$oh_t1"
  _oh_emit_p "resource_gate"             "$oh_t1" "$oh_t2"
  _oh_emit_p "build_dist"                "$oh_t2" "$oh_t3"
  _oh_emit_p "run_static_checks"         "$oh_t3" "$oh_t4"
  _oh_emit_p "gap_ms_pre_to_serial"      "$oh_t4" "$oh_t5"
  _oh_emit_p "serial_phase"              "$oh_t5" "$oh_t5b"
  _oh_emit_p "gap_ms_serial_to_lowconc"  "$oh_t5b" "$oh_t6"
  _oh_emit_p "lowconc_phase"             "$oh_t6" "$oh_t6b"
  # main_phase is emitted ONLY by the full path (needs oh_t7 set) — a truncated main stays absent.
}

_oh_install_partial_trap() {
  # SIGTERM → emit + re-raise 128+15 (the shell's signal-convention exit code, which the runner
  # already classifies as a signal-kill/abort — never a false green); EXIT is the backstop for a
  # set -e / any other non-SIGTERM truncation. _oh_done guards both paths so the emit runs exactly
  # once whether the exit is SIGTERM→EXIT or a plain EXIT.
  trap '_oh_emit_partial; exit 143' SIGTERM
  trap '_oh_emit_partial' EXIT
}

run_selected() {
  local groups="$1"; shift
  # Phase marks + oh_full are GLOBAL (no `local`): the SIGTERM/EXIT partial-fallback trap above runs
  # OUTSIDE this function's frame, and bash does not reliably give a trap handler dynamic scoping
  # into the interrupted frame — globals are the only channel for the trap to read the marks.
  oh_t0="" oh_t1="" oh_t2="" oh_t3="" oh_t4="" oh_t5="" oh_t5b="" oh_t6="" oh_t6b="" oh_t7=""
  oh_full=0
  # Fail-closed pre-flight (AC0b): an unknown @test-group declaration must abort, not silently
  # degrade to engine — a dropped group cancels the isolation guarantee without going red.
  check_group_declarations
  # The resource gate guards the FULL-SUITE default (product,engine). A non-default --group is a
  # subset run (e.g. --group governance) — scoped, skip it (QUAY_TEST_SKIP_RESOURCE_GATE=1 is
  # honored inside resource_gate_check for nested runners).
  if is_default_set "$groups"; then
    FULL_SUITE_DEFAULT=1
    oh_full=1
    # AC3 partial-fallback: arm the kill-on-red trap on the FULL path only. Scoped runs (oh_full=0)
    # skip it — their fixed overhead is not the object of measurement.
    _oh_done=0
    _oh_install_partial_trap
    oh_t0=$(_oh_mark)
    # Single-flight lock FIRST (serialize with any already-running full suite), then the resource
    # gate (GO/WAIT on the machine's load at actual start time). Order matters: the lock queues the
    # second suite, so the gate's verdict is computed AFTER serialization — never against stale load.
    full_suite_lock_acquire
    oh_t1=$(_oh_mark)
    resource_gate_check
    oh_t2=$(_oh_mark)
  fi
  build_dist_once
  oh_t3=$(_oh_mark)
  run_static_checks
  oh_t4=$(_oh_mark)
  export QUAY_TEST_GROUPS="$groups"
  local files=() f
  while IFS= read -r f; do files+=("$f"); done < <(select_files "$groups")
  if [ "${#files[@]}" -eq 0 ]; then
    echo "scripts/test.sh: no test files matched groups '$groups' (packages/*/test/*.test.mjs, plugin/test/*.test.mjs, experiments/quay-perpetual-stream/test/*.test.mjs)" >&2
    exit 1
  fi
  # gap-test-sh-flags-only-form-silently-runs-a-different-suite (AC4): every GLOB-SELECTED run
  # (default no-args, --group, flags-only) SELF-REPORTS its selection before executing, so a
  # changed selection can never be silent — the 2296→8573 defect hid precisely because nothing
  # stated how many files were being selected. Explicit-file and --for-task runs name their files
  # explicitly, so their selection is already visible. N here is exactly what `--list-files` prints
  # (the same select_files output), so AC4's "N == --list-files count" holds by construction.
  echo "selected ${#files[@]} files (groups=${groups})"
  # FULL-SUITE default path: run node as a CHILD (not exec) so the suite-AFTER assertion
  # (tmux-leak-scan) fires after node finishes — an exec'd node would replace this shell and skip
  # it. The suite-after clean-tree assertion is DISABLED (human ruling 17:1x): its premise — the
  # coordinator runs on a clean tree — is void under three concurrent writers, so it produced
  # false reds (r4/r5/r6) and no longer participates in the red verdict. Re-enable when the
  # verification worktree achieves runtime single-writer via `git worktree lock` (re-enable
  # condition documented in the kept suite-after clean-tree script's header).
  # The concurrency flag is bound to a variable here because the literal
  # `--test-concurrency="$(default_test_concurrency)"` spelling is pinned by
  # plugin/test/resource-gate.test.mjs AC5 (exactly 5 sites) and select-tests-for-touches.test.mjs
  # AC11 — the default-path branch must not add a sixth literal site.
  if [ "${FULL_SUITE_DEFAULT:-0}" = "1" ]; then
    local cc
    cc="$(default_test_concurrency)"
    mark_nested
    # Suite-BEFORE snapshot (gap-assert-clean-tree-premise-void-under-concurrent-writers): capture
    # the pre-run porcelain so a re-enabled suite-AFTER assertion is DELTA — only items newly added
    # DURING the run count as test products. Preexisting dirt from concurrent writers (manager
    # tick-log, outer worktree scaffolding, inner uncommitted change) is excluded. The snapshot is
    # gitignored. NON-FATAL while the assertion is DISABLED (the clean-tree call itself stays
    # disabled per the 17:1x ruling — restore fail-closed here when the assertion is re-enabled).
    bash "${repo_root}/plugin/scripts/assert-clean-tree.sh" --snapshot "${repo_root}" || true
    # Same-family DELTA for tmux-leak-scan: pre-existing outer/manager tmux sessions are not this
    # run's leak. Snapshot failure is non-fatal (the absolute suite-tail check still runs after).
    bash "${repo_root}/plugin/scripts/tmux-leak-scan.sh" --snapshot "${repo_root}" || true
    set +e
    # Phase order (gap-phase-order-serial-lowconc-before-main): serial and lowconc phases run
    # BEFORE the main concurrency-N body so a failure in a serial/lowconc file is judged red at
    # the phase boundary (minutes) instead of AFTER the entire main phase's cost has been paid —
    # the 16 long-reds were all judged red exactly total−30s=RED_GRACE_MS because their failures
    # lived in the LAST phases (serial/lowconc) and paid the whole main phase first (2.37h pure
    # waste). Phases are independent and serially sequenced (no shared state between phase runs),
    # so the reorder changes wall-clock latency only, never correctness.
    local code=0
    # SERIAL GROUP phase (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests):
    # the A/B-class KNOWN-LOAD-SENSITIVE family (nested-suite-spawn + real-wall-clock-wait) PLUS
    # the REAL-INSTALL install/quay-init family is routed OUT of the concurrency-N main body into
    # a `serial` group that runs BEFORE it, ALONE, at concurrency $SERIAL_CONCURRENCY (default 2 —
    # raised from 1 by the AC2 controlled experiment, gap-load-sensitive-serial-phase-unbounded-
    # growth-measure-first) —
    # the mechanical isolation that keeps real-wall-clock-wait, nested-suite-spawn, and real-install
    # tests from being starved by the main body's worker pool. The install/quay-init family was
    # admitted to serial at round 162 after rotating flakes across groups under full-suite load
    # (rounds 160/161/162 — a different file each round;
    # gap-install-family-tests-rotate-flakes-under-full-suite). The concurrency default is 1 —
    # serial isolation is the mechanism's invariant; QUAY_SERIAL_CONCURRENCY is the measure-first
    # override (gap-load-sensitive-serial-phase-unbounded-growth-measure-first AC2) — the default is
    # bumped only after an experiment proves 0-cancelled at a higher value (the --group serial path
    # in the non-default branch strips explicit concurrency flags for the same isolation reason).
    # Its TAP summary lands FIRST on the
    # stream (before the main body), so a serial failure flips the run red BEFORE the main phase's
    # cost is paid (gap-phase-order-serial-lowconc-before-main) — the phase runs EVEN IF a later
    # phase fails (report all failures; the serial exit code merges into `code`), so a red main
    # must not leave the serial files' verdict unknown (gap-post-merge-verification-failure-batch
    # AC3: round 95 skipped serial when main was red, so serial failures were invisible).
    local serial_files=() sf serial_code
    while IFS= read -r sf; do serial_files+=("$sf"); done < <(select_files "serial")
    [ "$oh_full" -eq 1 ] && oh_t5=$(_oh_mark)
    if [ "${#serial_files[@]}" -gt 0 ]; then
      echo "selected ${#serial_files[@]} files (groups=serial)"
      node --test --test-concurrency="$SERIAL_CONCURRENCY" $(suite_reporter_flags) "${serial_files[@]}"
      serial_code=$?
      [ "$serial_code" -eq 0 ] || code="$serial_code"
    fi
    [ "$oh_full" -eq 1 ] && oh_t5b=$(_oh_mark)
    # LOWCONC phase (gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive, AC1/AC4): the
    # hermetic-but-load-sensitive files (B-class session-observation family, each private socket /
    # wall-clock wait — the install/quay-init family LEFT this group for serial in round 162,
    # gap-install-family-tests-rotate-flakes-under-full-suite) run in their OWN phase at
    # `--test-concurrency=$LOWCONC_CONCURRENCY` (default 3) — not the derived default and not 8 — so
    # wait-type tests get timely scheduling. The phase runs even if another phase failed (report all
    # failures); its exit code merges into `code`. Runs BEFORE the main body so a lowconc failure is
    # judged red at the phase boundary (gap-phase-order-serial-lowconc-before-main). The default 3 is
    # deliberate (AC4) and does NOT add a derived-concurrency literal site (resource-gate AC5 pins
    # exactly 5 `--test-concurrency="$(default_test_concurrency)"` sites).
    local lowconc_files=() lf
    while IFS= read -r lf; do lowconc_files+=("$lf"); done < <(select_files "lowconc")
    [ "$oh_full" -eq 1 ] && oh_t6=$(_oh_mark)
    if [ "${#lowconc_files[@]}" -gt 0 ]; then
      echo "selected ${#lowconc_files[@]} files (groups=lowconc)"
      node --test --test-concurrency="$LOWCONC_CONCURRENCY" $(suite_reporter_flags) "${lowconc_files[@]}"
      local lcode=$?
      [ "$lcode" -eq 0 ] || code="$lcode"
    fi
    [ "$oh_full" -eq 1 ] && oh_t6b=$(_oh_mark)
    # MAIN phase (the concurrency-N default body) — runs LAST, after serial/lowconc
    # (gap-phase-order-serial-lowconc-before-main): a serial/lowconc failure is now judged red at
    # the phase boundary, never after the entire main phase's cost has been paid.
    # has_explicit_concurrency: an explicit --test-concurrency flag is the SINGLE concurrency
    # source — skip the default prepend (gap-full-suite-runner-concurrency-default-and-gate AC2).
    local mcode=0
    if has_explicit_concurrency "$@"; then
      node --test $(suite_reporter_flags) "$@" "${files[@]}"
      mcode=$?
    else
      node --test --test-concurrency="$cc" $(suite_reporter_flags) "$@" "${files[@]}"
      mcode=$?
    fi
    [ "$mcode" -eq 0 ] || code="$mcode"
    [ "$oh_full" -eq 1 ] && oh_t7=$(_oh_mark)
    # Fixed-overhead breakdown (gap-suite-fixed-overhead-decomposition AC2): emit the deterministic
    # serial-segment durations. Each is a DIRECT measurement of one sequential step — decidable,
    # unlike wall-clock diffs inside the 17–63s noise band. The "gap" segments are the inter-phase
    # serial transitions (select/echo between phases: oh_t4→oh_t5 pre→serial, oh_t5b→oh_t6
    # serial→lowconc); the phase segments (serial/lowconc/main) are the node --test runs themselves.
    # Label tokens deliberately match the task's measure grep (`build_dist|run_static|resource_gate|gap_ms`).
    if [ "$oh_full" -eq 1 ]; then
      _oh_emit "lock_overhead"      "$oh_t0" "$oh_t1"
      _oh_emit "resource_gate"      "$oh_t1" "$oh_t2"
      _oh_emit "build_dist"         "$oh_t2" "$oh_t3"
      _oh_emit "run_static_checks"  "$oh_t3" "$oh_t4"
      _oh_emit "gap_ms_pre_to_serial"    "$oh_t4" "$oh_t5"
      _oh_emit "serial_phase"       "$oh_t5" "$oh_t5b"
      _oh_emit "gap_ms_serial_to_lowconc" "$oh_t5b" "$oh_t6"
      _oh_emit "lowconc_phase"      "$oh_t6" "$oh_t6b"
      _oh_emit "main_phase"         "$oh_t6b" "$oh_t7"
      # The FULL decomposition is on the wire — suppress the partial fallback so a subsequent
      # SIGTERM/EXIT trap (and the SIGTERM→EXIT chain) is a no-op.
      _oh_done=1
    fi
    set -e
    # DISABLED (human ruling 17:1x, disable-not-delete): the suite-after clean-tree assertion NO
    # LONGER RUNS here. Its premise — the coordinator runs on a clean tree — is VOID under three
    # concurrent writers (manager tick-log append / outer worktree scaffolding / inner uncommitted
    # change), which produced three false reds (r4/r5/r6) and a mis-cleaning config cascade. It
    # cannot participate in the red verdict until the re-enable condition — the verification
    # worktree achieves runtime SINGLE-WRITER via `git worktree lock` — is met. The kept script
    # (not deleted, per the disable ruling) and the full re-enable condition + delta-form note live
    # in the suite-after clean-tree script's header.
    # KNOWN TRADE-OFF (AC4): catching a test that GENUINELY leaks into the verification tree is
    # TEMPORARILY ABSENT while disabled; the tmux-leak-scan below still catches the tmux leak class.
    # Suite-AFTER assertion, DELTA form (AC1, gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause):
    # a FULL SUITE must leave no test-characteristic tmux server or /tmp dir behind (skv- /
    # session-liveness- / ol-tok- / enter-repro- prefixes). Delta: only items absent from the
    # before-run snapshot are this run's leak. Second line of defense — the teardown fix
    # (kill-session, never kill-server) is primary; this covers the whole leak class at once.
    # Same flip-only-a-passing-run semantics as assert-clean-tree above.
    # Candidate C (gap-runner-failure-patterns-miss-info-glyph-and-perfile-failed AC5): the leak scan
    # runs UNCONDITIONALLY — the `&&` short-circuit (old `[ "$code" -eq 0 ] && ! bash ...`) swallowed
    # the scan whenever the test phase exited non-zero, so a test-red ALSO hid a genuine leak-class
    # residual (the snapshot was deleted by --check's success path or left stale). A leak is a REAL
    # residual, independent of test-failure reporting — merge its verdict into code so the runner's
    # tmux-leak-scan: FAIL line reaches the stream and failures[].
    if ! bash "${repo_root}/plugin/scripts/tmux-leak-scan.sh" --check "${repo_root}"; then
      code=1
    fi
    full_suite_lock_release
    exit "$code"
  fi
  mark_nested
  # SERIAL group run (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests):
  # the serial group is isolated by definition — concurrency $SERIAL_CONCURRENCY (default 2 = the
  # invariant; the measure-first override of gap-load-sensitive-serial-phase-unbounded-growth-
  # measure-first AC2/AC3, bumped only after an experiment proves 0-cancelled).
  # Strip any explicit --test-concurrency flag (both spellings) so the env-driven SERIAL_CONCURRENCY
  # is the SINGLE concurrency source — a full-suite-runner splice onto a `--group serial` command
  # must not leak concurrency N in.
  if in_group "serial" "$groups"; then
    local filtered=() a prev_arg=""
    for a in "$@"; do
      case "$a" in
        --test-concurrency=*) continue ;;
        --test-concurrency) prev_arg="continue" ; continue ;;
      esac
      if [ "$prev_arg" = "continue" ]; then prev_arg=""; continue; fi
      filtered+=("$a")
    done
    exec node --test --test-concurrency="$SERIAL_CONCURRENCY" $(suite_reporter_flags) "${filtered[@]}" "${files[@]}"
  fi
  # LOWCONC group run (gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive, AC1/AC4):
  # `--group lowconc` runs the hermetic-but-load-sensitive phase ALONE at its own concurrency
  # $LOWCONC_CONCURRENCY — not the derived default. An explicit user --test-concurrency flag still
  # wins (single concurrency source, AC2). The default 3 adds no derived-concurrency literal site.
  local lowconc_force=""
  if in_group "lowconc" "$groups"; then
    lowconc_force="--test-concurrency=$LOWCONC_CONCURRENCY"
  fi
  # has_explicit_concurrency: an explicit --test-concurrency flag is the SINGLE concurrency source
  # (gap-full-suite-runner-concurrency-default-and-gate AC2) — skip the default prepend.
  if has_explicit_concurrency "$@"; then
    exec node --test $(suite_reporter_flags) "$@" "${files[@]}"
  elif [ -n "$lowconc_force" ]; then
    exec node --test "$lowconc_force" $(suite_reporter_flags) "$@" "${files[@]}"
  else
    exec node --test --test-concurrency="$(default_test_concurrency)" "$@" "${files[@]}"
  fi
}

# ── argument dispatch ────────────────────────────────────────────────────────────────────────────

# all_flags "$@" — return 0 iff EVERY argument starts with '-'. Detects the flags-only invocation
# form (gap-test-sh-flags-only-form-silently-runs-a-different-suite): when nothing but node --test
# flags remain after subcommand handling, treat them as extra flags + the selected glob rather than
# as file paths. An empty "$@" returns 0, but every caller checks $# -eq 0 first.
all_flags() {
  local a
  for a in "$@"; do
    case "$a" in
      -*) ;;
      *) return 1 ;;
    esac
  done
  return 0
}

groups=""
if [ "${1:-}" = "--group" ]; then
  groups="${2:-}"
  if [ -z "${groups}" ]; then
    echo "scripts/test.sh: --group requires a group name (product|engine|governance|serial|lowconc, comma-separated)" >&2
    exit 2
  fi
  shift 2
fi

if [ "${1:-}" = "--list-groups" ]; then
  # Metadata mode (AC10) — no test run, no split-or-commit scan. Always reports the FULL
  # deduped glob's per-group counts, independent of any --group.
  check_group_declarations
  list_groups
  exit 0
elif [ "${1:-}" = "--list-files" ]; then
  # Metadata mode (test support / AC6) — print the selected file list, one per line. Respects
  # --group if given; else the DEFAULT RUN's full selection = the product,engine body (with
  # governance self-skip passthrough) PLUS the lowconc phase files — a default `bash
  # scripts/test.sh` executes BOTH (the concurrent body, then the serial phase, then the lowconc
  # phase), so no-args --list-files reports the full reachable surface and keeps the
  # runner-grouping AC3 invariant (`--list-files count + serial == --list-groups total`) and the
  # test-coverage-check AC5 canonical-coverage invariant. A serial/lowconc file is NOT in the
  # default GROUP SET; it is in the default RUN (its own phase) — hence
  # `--group product,engine --list-files` differs from no-args unless lowconc is named
  # (runner-grouping AC6 pins `--group product,engine,lowconc --list-files == no-args --list-files`).
  check_group_declarations
  if [ -n "${groups}" ]; then
    select_files "$groups"
  else
    select_files "$(effective_groups)"
    select_files "lowconc"
  fi
  exit 0
elif [ -n "${groups}" ]; then
  if [ "$#" -eq 0 ]; then
    # Run the glob filtered to the requested groups.
    run_selected "$groups"
  elif all_flags "$@"; then
    # gap-test-sh-flags-only-...: bare node --test flags + the group's glob (e.g.
    # `--group governance --test-concurrency=4`). Previously this fell to the explicit-file branch
    # with an EMPTY file list → node --test auto-discovered a 3.7x-larger, different suite.
    run_selected "$groups" "$@"
  else
    # Explicit files with the group env set (in-file skips apply). Static checks still run —
    # "every test-running invocation" is the documented invariant (REFUTE round-1 MINOR).
    run_static_checks
    export QUAY_TEST_GROUPS="$groups"
    build_dist_once
    mark_nested
    # has_explicit_concurrency: explicit flag wins as the single concurrency source (AC2).
    if has_explicit_concurrency "$@"; then
      exec node --test "$@"
    else
      exec node --test --test-concurrency="$(default_test_concurrency)" "$@"
    fi
  fi
fi

if [ "$#" -eq 0 ]; then
  # Default: product,engine (AC4). Governance files are passed through too — they self-skip,
  # so they report `skipped`, not absent (ADR-019 decision #1 precedent). run_selected runs
  # the split-or-commit whole-store scan.
  run_selected "$(effective_groups)"
elif [ "${1:-}" = "--static-checks" ]; then
  # Gate-only mode (gap-scoped-runs-pay-full-static-check-overhead, AC2 proof): run the COMPLETE
  # static-check set (run_static_checks — the same set the full-suite path runs) with NO test run.
  # The outer verification round and the AC2 "full set unchanged" mechanical proof use this to run
  # the full gate without paying the test suite.
  run_static_checks
  exit 0
elif [ "${1:-}" = "--for-task" ] || [ "${1:-}" = "--scoped" ]; then
  # gap-test-selection-not-scoped-to-touches: mechanical per-task test selection. `scripts/test.sh
  # --for-task <id>` delegates to select-tests-for-touches.ts (which resolves the task's ## Touches
  # to a test set) and runs EXACTLY that set. `--scoped <id>` is the SAME scoped task path (the
  # measure surface named by the gap-scoped-runs-pay-full-static-check-overhead Contract); `--scoped
  # <file...>` (a repo-relative test file, not a task id) treats the given files as the change's
  # touches and runs them with the scoped static-check tier. Additive: the full-suite default and
  # the explicit-file form are unchanged. `--allow-thin` passes through to the selector.
  #
  # Scoped static-check tier: instead of the FULL run_static_checks (which scoped runs used to pay,
  # ~16s, 13s of it checker-mutation-check), a task-scoped run runs the change-relevant subset —
  # checks whose object intersects the touches + the ## Contract consumer on the touched task files
  # (run_scoped_static_checks_sel below). The full set is deferred to the full-suite gate, not dropped.
  scoped_flag="${1}"
  scoped_arg="${2:-}"
  if [ -z "${scoped_arg}" ]; then
    echo "scripts/test.sh: ${scoped_flag} requires a task id (or, for --scoped, a test-file path)" >&2
    exit 2
  fi
  if [ "${scoped_flag}" = "--scoped" ] && [ ! -f "${repo_root}/tasks/${scoped_arg}.md" ]; then
    # --scoped <file...>: the argument is not a task id — treat the given files as the change's
    # touches and run them with the scoped static-check tier (the contract's `<单文件>` surface).
    shift 1
    run_scoped_static_checks_touches "$(IFS=,; echo "$*")"
    build_dist_once
    mark_nested
    # has_explicit_concurrency: explicit flag wins as the single concurrency source (AC2).
    if has_explicit_concurrency "$@"; then
      exec node --test "$@"
    else
      exec node --test --test-concurrency="$(default_test_concurrency)" "$@"
    fi
  fi
  task_id="${scoped_arg}"
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
    # selector's own code (so `test-selection-thin` still surfaces non-zero). Scoped static checks
    # do not run for a selector-only query (no test run to gate) — same as --list-files/--list-groups.
    printf '%s\n' "${sel_out}"
    exit "${sel_code}"
  fi
  # Scoped static-check tier — the change-relevant subset (the full set is the full-suite gate's job).
  run_scoped_static_checks "${task_id}"
  # A here-string always appends a newline, so `mapfile <<< ""` yields a 1-element [""] array — the
  # empty case MUST be guarded on the string itself, not on the array length.
  if [ -z "${sel_out}" ]; then
    if [ "${sel_code}" -eq 2 ]; then
      echo "scripts/test.sh: ${scoped_flag} ${task_id} — selector could not resolve the task (exit 2)" >&2
      exit 2
    fi
    if [ -n "${allow_thin_flag}" ]; then
      # --allow-thin + zero tests to run: nothing to do, and the user explicitly accepted thin.
      echo "scripts/test.sh: ${scoped_flag} ${task_id} — selector selected 0 test files (thin allowed); nothing to run, full suite still runs at fan-in" >&2
      exit 0
    fi
    echo "scripts/test.sh: ${scoped_flag} ${task_id} selected no test files (selector exit ${sel_code}); add --allow-thin to force" >&2
    exit 1
  fi
  mapfile -t files <<< "${sel_out}"
  # Run the selected set. A thin selector (sel_code != 0) still runs what was selected but the overall
  # exit is non-zero — fail-loud under-selection must never be masked by a green test run.
  build_dist_once
  mark_nested
  set +e
  # Pass-through flags (e.g. --test-name-pattern=X) must precede the file list: node --test only
  # honors --test-name-pattern when it appears BEFORE the named files (after them it is ignored,
  # which would run the whole file — and for this self-referential test, recurse).
  # has_explicit_concurrency: explicit flag wins as the single concurrency source (AC2).
  if has_explicit_concurrency "${rest_args[@]}"; then
    node --test "${rest_args[@]}" "${files[@]}"
  else
    node --test --test-concurrency="$(default_test_concurrency)" "${rest_args[@]}" "${files[@]}"
  fi
  test_code=$?
  set -e
  if [ "${sel_code}" -ne 0 ]; then
    echo "scripts/test.sh: ${scoped_flag} ${task_id} — test-selection-thin (selector exit ${sel_code}); re-run with --allow-thin to suppress" >&2
    exit "${sel_code}"
  fi
  exit "${test_code}"
elif all_flags "$@"; then
  # gap-test-sh-flags-only-...: bare node --test flags + the DEFAULT glob (the documented
  # `--test-concurrency=4` and `--experimental-test-coverage` forms). Previously these fell to the
  # explicit-file branch with an empty file list → node auto-discovered a 3.7x-larger suite (8573
  # vs 2296). node --test is last-flag-wins, so the user's own --test-concurrency=N still overrides
  # the derived default (default_test_concurrency, gap-no-resource-awareness-heavy-ops-run-blind AC5).
  run_selected "$(effective_groups)" "$@"
else
  build_dist_once
  run_static_checks
  # Explicit file list (no --group): QUAY_TEST_GROUPS stays unset, so in-file skips do not
  # trigger and the named files run in full.
  mark_nested
  # has_explicit_concurrency: explicit flag wins as the single concurrency source (AC2).
  if has_explicit_concurrency "$@"; then
    exec node --test "$@"
  else
    exec node --test --test-concurrency="$(default_test_concurrency)" "$@"
  fi
fi
