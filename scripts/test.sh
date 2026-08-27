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

# gap-gitignored-carriers-absent-in-verify-worktree — the MAIN CHECKOUT path, for checkers that audit
# the main repo's gitignored .quay/ runtime carriers (fan-in-workflow-check / fan-in-ff-protocol-check
# / direct-to-develop-bypass-check). full-suite-runner.ts sets QUAY_MAIN_CHECKOUT to the main checkout
# (the one-shot verify worktree lacks the gitignored carriers — .quay/fan-in-merge-lock-events.jsonl
# etc. — so those checkers were constant-green NOT-EVALUATED every round while their input did not
# exist). On a main-checkout run QUAY_MAIN_CHECKOUT is unset ⇒ main_root == repo_root and behavior is
# unchanged; on a one-shot round main_root = the real main checkout ⇒ the worktree round's checkers
# read the SAME data as a main run ⇒ verdicts are identical (AC3).
main_root="${QUAY_MAIN_CHECKOUT:-$repo_root}"

# gap-fan-in-worktree-quay-provisioning — the fan-in DIRECT path runs test.sh in the linked task
# worktree WITHOUT QUAY_MAIN_CHECKOUT (only full-suite-runner.ts sets it for the one-shot path).
# Derive the main checkout from git so the carriers checkers (fan-in-workflow-check etc., which read
# `main_root/.quay/*`) resolve the MAIN's live runtime carriers AND its session-dir hash — the
# worktree's gitignored .quay is absent (or a snapshot) and its session-dir hash differs ⇒ agentId
# resolution fails ⇒ a false "fan-in-without-workflow" RED. On a main-checkout run the git-derived
# first worktree == repo_root ⇒ main_root is unchanged.
#
# ⚠️ The git-derived first worktree is ALWAYS preferred (even when QUAY_MAIN_CHECKOUT is set):
# full-suite-runner.ts launches with `--root <worktree>` in the execute-suite-fix shape, so its
# `mainRoot = root` = the WORKTREE and QUAY_MAIN_CHECKOUT points at the worktree — whose project-dir
# slug has no session transcripts ⇒ fan-in-workflow-check agent IDs unresolvable ⇒ a false
# "fan-in-without-workflow" RED (round 214, 2026-08-16). `git worktree list --porcelain`'s FIRST
# entry is the git primary (main) checkout, which is authoritative and always correct.
# `|| _derived_main=""` guards the command substitution under `set -euo pipefail` (a non-git /
# non-worktree cwd must NOT abort the suite — it just keeps main_root == repo_root).
_derived_main="$(git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2; exit}')" || _derived_main=""
if [ -n "${_derived_main}" ] && [ "${_derived_main}" != "${repo_root}" ]; then
  main_root="${_derived_main}"
fi

# ── gap-fan-in-worktree-quay-provisioning — the worktree suite must read the MAIN's .quay ─────────
# `.quay/` is gitignored ⇒ `git worktree add` copies NONE of it. The fan-in full suite runs DIRECTLY
# in the task worktree (`cd ${worktree} && bash scripts/test.sh` — no full-suite-runner provisioning),
# so `<worktree>/.quay/config.yml` was absent or stale ⇒ the suite's repo-root resolution
# (_findRepoRoot) and config/gates tests (M63 ts-typecheck, blocked-signal, cap-from-gate,
# monitor-mount, run-identity — ruled-gap fan-in: 72 environmental REDs across 22 files, ALL green
# on the main checkout) failed environmentally. This is the OTHER half of gap-gitignored-carriers:
# the carriers fix (QUAY_MAIN_CHECKOUT) pointed CHECKERS at the main; this snapshots the main's
# .quay/ (config/gates/runtime carriers) into the worktree so the SUITE reads the same data.
# refresh-worktree-quay.sh is a no-op on a main-checkout run (its linked-worktree guard) and is
# idempotent; the copy source is QUAY_MAIN_CHECKOUT when set (full-suite-runner one-shot) else the
# git-derived main worktree (fan-in direct path).
# Metadata probes (--list-files / --list-groups, incl. `--group X --list-files`) only LIST files —
# they run NO tests, so no .quay refresh is needed. Skipping them keeps the runner-grouping family's
# nested probes cheap: each probe previously paid a ~23s refresh (the enumeration iterated
# node-compile-cache's 346K+ ignored files), and the widened per-probe window turned the transient
# zz-unknown-group fixture (runner-grouping-serial-anti-stomp) into a near-certain AC6 false red.
# Real runs (plain / --group X without --list-files / --for-task) still refresh.
case " $* " in
  *"--list-files"*|*"--list-groups"*) ;;
  *)
    if [ -f "${repo_root}/plugin/scripts/refresh-worktree-quay.sh" ]; then
      bash "${repo_root}/plugin/scripts/refresh-worktree-quay.sh" "${repo_root}" \
        || echo "scripts/test.sh: WARNING — refresh-worktree-quay.sh failed (exit $?); the suite may be environmentally red in this worktree" >&2
    fi
    ;;
esac

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

# run_static_checks — the repo-wide CODE-CLASS invariants (checker registry + @static-tier/@static-object
# annotations) — extracted to plugin/scripts/runner-static-gate.ts (gap-ac128-hub-split-harness-concerns).
# Sourced here so the suite's dispatch paths call the SAME function body; select-static-checks-for-touches.ts
# and checker-mutation-check.sh now parse the registry from that file (the single source, never a
# hand-maintained list). runner-static-gate.ts is a HUB file (suite-bucket-hub-list.ts) — harness-critical.
source "${repo_root}/plugin/scripts/runner-static-gate.ts"
# run_doc_checks — the DOC-CLASS static checks (AC51 断言面拆分, gap-ac51-assertion-surface-split,
# SPEC §13). These are the doc-consistency checkers whose judgment objects are ONLY document files
# (tick-core docs, driver docs, CLAUDE.md, docs/proposals) and which never execute tested product
# code. AC51 moves them OUT of the full-suite gate (run_static_checks) and INTO the pre-commit
# moment: `scripts/test.sh --static-checks-doc` is the ONLY caller (wired into
# plugin/scripts/precommit-guard.ts). They run at commit time — seconds-level feedback instead of
# waiting a full 8-minute suite round — and because they no longer run in the suite, editing a doc
# in the main checkout no longer makes any running round red.
#
# Each checker carries `# @static-class doc` — the mechanical marker that:
#   - precommit-guard.ts parses to exclude doc files from the running-round assertion surface, and
#   - checker-mutation-check.sh keeps in its manifest (the moved checkers' mutation cases still run
#     in the full-suite gate — the L_S instrument is NOT weakened by the split).
# The scoped static-check selector (select-static-checks-for-touches.ts) parses run_static_checks
# only, so doc-class checkers are absent from the scoped tier by construction — a task-scoped run
# does NOT re-pay them (pre-commit is their home).
run_doc_checks() {
  echo "== doc-class static checks (AC51 — pre-commit only; NOT part of the full-suite gate) =="
  local _doc_rc=0
  # Sequential (never parallel): the pre-commit path must attribute failures synchronously. If a
  # caller left RUN_CHECKER_PARALLEL=1 set, force it off — backgrounded checkers would return 0
  # immediately and mask a doc-check failure.
  RUN_CHECKER_PARALLEL=0
  set +e
  # @static-class doc
  # @static-object docs/proposals/ orchestration/
  echo "  [doc-check] strategic-doc-staleness-check"
  run_checker "strategic-doc-staleness-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/strategic-doc-staleness-check.ts" --root "${repo_root}"
  _doc_rc=$(( _doc_rc || $? ))
  # @static-class doc
  # @static-object plugin/loop/fast-mode-loop-tick.md plugin/loop/orchestrator-loop-tick.md orchestration/QUAY-OUTER-HANDOFF.md
  echo "  [doc-check] drive-contract-check"
  run_checker "drive-contract-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/drive-contract-check.ts" --root "${repo_root}"
  _doc_rc=$(( _doc_rc || $? ))
  # @static-class doc
  # @static-object plugin/loop/fast-mode-loop-tick.md plugin/loop/orchestrator-loop-tick.md CLAUDE.md plugin/scripts/threshold-scope-check.ts plugin/test/threshold-scope-check.test.mjs docs/analysis/threshold-scope-violations.md
  echo "  [doc-check] threshold-scope-check"
  run_checker "threshold-scope-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/threshold-scope-check.ts" --root "${repo_root}"
  _doc_rc=$(( _doc_rc || $? ))
  # @static-class doc
  # @static-object orchestration/manager-tick-core.md orchestration/orchestrator-tick-core.md orchestration/fast-mode-tick-core.md plugin/scripts/state-worded-clause-check.ts plugin/test/state-worded-clause-check.test.mjs
  echo "  [doc-check] state-worded-clause-check"
  run_checker "state-worded-clause-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/state-worded-clause-check.ts" --root "${repo_root}"
  _doc_rc=$(( _doc_rc || $? ))
  # @static-class doc
  # @static-object orchestration/orchestrator-tick-core.md plugin/scripts/red-on-omission-audit.ts plugin/test/red-on-omission-audit.test.mjs
  echo "  [doc-check] red-on-omission-audit"
  run_checker "red-on-omission-audit" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/red-on-omission-audit.ts" --root "${repo_root}"
  _doc_rc=$(( _doc_rc || $? ))
  # @static-class doc
  # @static-object orchestration/manager-tick-core.md orchestration/orchestrator-tick-core.md orchestration/fast-mode-tick-core.md orchestration/outer-brief-2026-08-04-third-restart.md orchestration/QUAY-OUTER-HANDOFF.md orchestration/exp6-phase1-sustained-unattended-operation.md plugin/loop/orchestrator-loop-tick.md plugin/scripts/tick-core-static-check.ts plugin/test/tick-core-static-check.test.mjs
  echo "  [doc-check] tick-core-static-check"
  run_checker "tick-core-static-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/tick-core-static-check.ts" --root "${repo_root}"
  _doc_rc=$(( _doc_rc || $? ))
  # @static-class doc
  # @static-object orchestration/manager-tick-core.md orchestration/orchestrator-tick-core.md orchestration/fast-mode-tick-core.md plugin/loop/manager-tick-core.md plugin/loop/orchestrator-tick-core.md plugin/loop/fast-mode-tick-core.md
  echo "  [doc-check] tick-core-drift-check"
  # gap-tick-core-drift-check-not-in-suite + gap-ac90-delivery-copy-drift-gate: the three execution
  # cores ship in TWO copies each — orchestration/*-tick-core.md (what the three layers ACTUALLY
  # read every tick) and plugin/loop/*-tick-core.md (the shipped/laid-down copy quay-init --loop
  # delivers). quay-init's `--check-drift` report already LISTED these but had NO suite consumer
  # (the fifth "instrument exists, consumer doesn't" instance — A12 line :31 vs :45 actually misled
  # a round). Wired here at the pre-commit doc surface (AC51 — the check's objects are tick-core
  # DOCS, so it lives with the sibling tick-core-static-check in run_doc_checks, not the code-class
  # run_static_checks gate).
  # AC90 (gap-ac90-delivery-copy-drift-gate): HARD gate. The pairs are reconciled — the fast-mode
  # copy landed to 正本 semantics under normalized-byte (init/SKILL.md:71 非 byte-identical; the
  # behavioral body from `## A.` must match), the manager pairs are pointers — so ANY drift
  # (改正本而副本不落地 / 副本单边编辑) blocks the commit. The pre-reconcile --no-block window is
  # closed; the hard `--check-drift` mode is mutation-tested (checker-mutation-cases/
  # tick-core-static-check.sh INJECT #4/#5/#6, incl. the AC90 source-edit negative control).
  run_checker "tick-core-drift-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/tick-core-static-check.ts" --check-drift --root "${repo_root}"
  _doc_rc=$(( _doc_rc || $? ))
  # @static-class doc
  # @static-object orchestration/manager-loop-tick.md plugin/loop/fast-mode-loop-tick.md plugin/loop/manager-loop-tick.md plugin/loop/orchestrator-loop-tick.md
  echo "  [doc-check] instrument-failure-check"
  run_checker "instrument-failure-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/instrument-failure-check.ts" --gate --root "${repo_root}"
  _doc_rc=$(( _doc_rc || $? ))
  set -e
  return "$_doc_rc"
}

# run_scoped_static_checks — the change-relevant static-check TIER for SCOPED task runs
# (gap-scoped-runs-pay-full-static-check-overhead, AC1/AC3/AC6). A per-task scoped run used to pay
# the FULL run_static_checks fixed overhead (~16s, ~13s of it checker-mutation-check) even when it
# ran 1-2 test files. Scoped mode runs ONLY the checkers whose object intersects the task's
# `## Touches` (e.g. test-framework-policy/isolation when a test file is touched, the code/shell
# ratchets when their objects are touched) PLUS the always-relevant ## Contract consumer on the
# TOUCHED task files (AC1's exemplar — it has already caught 7 Contract violations), SKIPPING
# checker-mutation-check and the unrelated repo-level ratchets.
#
# Since AC51 (gap-ac51-assertion-surface-split) the DOC-CLASS checkers live in run_doc_checks
# (pre-commit), so they are absent from the scoped registry by construction — a doc-file touch does
# NOT select a doc checker in scoped; the pre-commit hook (precommit-guard.ts) runs them at commit
# time. A scoped skip of a code-class repo-level ratchet is DEFERRED to the full-suite gate, never
# dropped (AC4-ii: an unrelated repo-level ratchet violation is not caught by the scoped run and
# MUST be caught by the full run). The touch→checker relevance mapping is MECHANICAL
# (select-static-checks-for-touches.ts parses the `# @static-tier` / `# @static-object` annotations
# in run_static_checks — the SAME single source checker-mutation-check.sh parses; never a
# hand-maintained list, AC3).
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
# RESOURCE_GATE_CONCURRENT_SUITES / RESOURCE_GATE_OVERSUBSCRIPTION override the derivation inputs
# deterministically (S read via suite_slot_count, oversub = 旋钮③ — env-read, never literals).
# S single source (gap-suite-concurrency-S-two-source-divergence): default_concurrency_formula and
# serial_lowconc_host_default read S via suite_slot_count — the SAME bash canonical the single-flight
# lock uses (seam RESOURCE_GATE_CONCURRENT_SUITES → `<base>.concurrency` file →
# QUAY_MAX_CONCURRENT_SUITES → 1). Sourced HERE (before the derivation functions below) so both can
# call it; the lock section further down reuses this same canonical for its slot paths.
source "${repo_root}/plugin/scripts/suite-slot-lib.sh"
default_concurrency_formula() {
  local total_budget oversub slots
  # MAIN-PHASE CONCURRENCY (gap-suite-budget-oversubscribe; human 14:4xZ 修正方向 — (b) 认领制 /
  # (c) 锁发配额 均被否，纯计算零新增运行时状态): default = max(1, floor(nproc × oversub / S)).
  #   nproc   ← 宿主（nproc --all，⛔ 不写字面量 — CLAUDE.md 硬规则 4 推论二）
  #   oversub ← 旋钮③ QUAY_MAX_OVERSUBSCRIPTION（现 1，现状非建议值）
  #   S       ← 旋钮② QUAY_MAX_CONCURRENT_SUITES（现 1）
  # 之前 AC74 的 `nproc − in_use`（读运行时 in_use，不读 S）固有超用：每条 lane 只减它启动那一刻
  # 已在用的 in_use、没人减将来会来的 ⇒ 先起读≈0 拿满 nproc、后起读≈in_use 拿 nproc−in_use，
  # 两并发 suite 合计 16+8=24 > 16（load 29.23，2026-08-14 14:39Z）。纯计算下 S 个 suite 各拿
  # nproc×oversub/S ⇒ Σ lane ≤ nproc×oversub 结构上不可能超。单 suite 只拿 nproc/S（本机 8）是
  # 纯计算方案的已知代价（判据4），非缺陷；要单 suite 拿满由旋钮③ oversub 表达（⛔ 不动态放大）。
  # 阶段间并发（gap-lane-formula-ignores-phase-overlap-concurrency）：QUAY_PHASE_OVERLAP=1 时
  # serial+lowconc 并行（重叠窗口 Σ lane = serial+lowconc），serial_lowconc_host_default 的分母因此
  # 再乘并发阶段数 P ⇒ S×P ⇒ 重叠窗口 Σ lane ≤ nproc×oversub 同样结构上不可能超（不变式恢复可守）。
  total_budget="${RESOURCE_GATE_NPROC:-}"
  oversub="${RESOURCE_GATE_OVERSUBSCRIPTION:-${QUAY_MAX_OVERSUBSCRIPTION:-1}}"
  # S single source: suite_slot_count reads seam → `<base>.concurrency` file → 旋钮② → 1 (the SAME
  # precedence + validation as the single-flight lock). The old
  # `RESOURCE_GATE_CONCURRENT_SUITES:-${QUAY_MAX_CONCURRENT_SUITES:-2}` read SKIPPED the `.concurrency`
  # file — so `printf '2' > .concurrency` changed the lock slots but NOT this formula (the divergence).
  slots="$(suite_slot_count)"
  if [ -z "${total_budget}" ]; then
    total_budget="$(nproc 2>/dev/null || echo 1)"
  fi
  if ! awk -v o="${oversub}" 'BEGIN { exit !(o ~ /^[0-9]+(\.[0-9]+)?$/ && o > 0) }'; then
    oversub=1
  fi
  awk -v n="${total_budget}" -v o="${oversub}" -v s="${slots}" \
    'BEGIN { c = int(n * o / s); if (c < 1) c = 1; print c }'
}

default_test_concurrency() {
  default_concurrency_formula
}

# ── load-sensitive phase concurrency knobs (gap-load-sensitive-serial-phase-unbounded-growth-
# measure-first AC2/AC3 + gap-ac74-serial-lowconc-literal-direct-path AC44 直调读宿主) ─────────────
# The serial phase (KNOWN-LOAD-SENSITIVE A/B-class + real-install family) and the lowconc phase
# (hermetic-but-load-sensitive session-observation family) default to the HOST derivation
# max(1, floor(hostParallelism ÷ concurrentSuiteSlots)) — the SAME expression as full-suite-runner.ts's
# DEFAULT_SERIAL_CONCURRENCY / DEFAULT_LOWCONC_CONCURRENCY. AC44 (gap-ac44-concurrent-phases-read-
# host-parallelism) fixed the runner side; the DIRECT `bash scripts/test.sh` path previously fell back
# to 2/3 literals, so the two paths read DIFFERENT values (判据4: direct must equal runner = H÷S).
# Both remain env-overridable (QUAY_SERIAL_CONCURRENCY / QUAY_LOWCONC_CONCURRENCY) so a future
# controlled experiment can re-measure before the next bump — the measure-first rule
# (gap-suite-cost-model-is-wrong-optimizations-buy-nothing: 墙钟差异落 17-63s 噪声带).
# EXPERIMENT (2026-08-10, task body): A/B-class load-sensitive serial 子集 6 文件
#   cc=1 WALL_MS=455613 (0 cancelled) vs cc=2 WALL_MS=289579 (0 cancelled) — c2 快 36% 且 0-cancelled;
#   real-install e2e 双文件 c2 实测 0-cancelled (147s)。⇒ 默认上调至 2 (后经 AC44/AC74 改读宿主)。
# serial_lowconc_host_default — the host-derived fallback shared by BOTH phase knobs: reads
# RESOURCE_GATE_NPROC (test seam) → nproc, S via suite_slot_count (seam →
# `<base>.concurrency` file → QUAY_MAX_CONCURRENT_SUITES → 1, the single source), and
# QUAY_PHASE_OVERLAP (default 1) → the concurrent-PHASE count P (2 = serial+lowconc parallel,
# 1 = sequential). max(1, floor(nproc ÷ (S×P))).
# gap-lane-formula-ignores-phase-overlap-concurrency: QUAY_PHASE_OVERLAP=1 runs serial + lowconc in
# PARALLEL, so the overlap window carries 2 concurrent phases each at its own budget — the denominator
# must count the concurrent PHASES too (S×P), else each suite's overlap window runs serial+lowconc at
# 2×nproc/S and S suites reach S×2×nproc/S = 2×nproc > nproc×oversub (16+16=32 > 16 on this host).
# QUAY_PHASE_OVERLAP=0 = sequential ⇒ P = 1 (the pre-overlap H÷S budget, unchanged — AC3 negative
# control). This keeps the direct-path default byte-identical to the runner's
# DEFAULT_SERIAL_CONCURRENCY / DEFAULT_LOWCONC_CONCURRENCY.
serial_lowconc_host_default() {
  local ncpu slots phases
  ncpu="${RESOURCE_GATE_NPROC:-$(nproc 2>/dev/null || echo 1)}"
  # S single source: suite_slot_count (seam → `<base>.concurrency` file → 旋钮② → 1) — the SAME read
  # as default_concurrency_formula and the single-flight lock (gap-suite-concurrency-S-two-source-divergence).
  slots="$(suite_slot_count)"
  phases=1
  if [ "${QUAY_PHASE_OVERLAP:-1}" != "0" ]; then
    phases=2
  fi
  awk -v n="${ncpu}" -v s="${slots}" -v p="${phases}" 'BEGIN { c = int(n / (s * p)); if (c < 1) c = 1; print c }'
}
# The full-suite-runner sets these env vars when --serial-concurrency / --lowconc-concurrency are passed.
SERIAL_CONCURRENCY="${QUAY_SERIAL_CONCURRENCY:-$(serial_lowconc_host_default)}"
LOWCONC_CONCURRENCY="${QUAY_LOWCONC_CONCURRENCY:-$(serial_lowconc_host_default)}"

# ── phase-overlap knob (gap-phase-overlap-two-phase-parallel-exploration, AC1 + AC101 default-ON) ──
# QUAY_PHASE_OVERLAP=1 runs the serial and lowconc phases in PARALLEL on the FULL-SUITE path (each at
# its OWN $SERIAL_CONCURRENCY / $LOWCONC_CONCURRENCY) instead of sequentially — the two-phase-overlap
# exploration (serial+lowconc 并行, 预期 −154s/轮: the 331s sequential window 177+154 becomes
# max(177,154)≈177s). This changes phase SCHEDULING only, never a concurrency value (AC4: one
# variable at a time — $SERIAL_CONCURRENCY / $LOWCONC_CONCURRENCY stay exactly as configured; the
# "两个 6" in the task title reflects the author's reading, the live defaults here are host-derived
# (H÷S, gap-ac74) and are NOT part of this exploration's variable). AC101 (2026-08-16) flips the
# DEFAULT to 1 (overlap): the human-approved improvement becomes the default so the suite fits the
# ≤600s target — the AC101 对照轮 (round 218, no-churn window) measured serial 232s + lowconc 183s
# sequential (415s) ⇒ overlap max(232,183)=232s, saving ~183s/round. Set QUAY_PHASE_OVERLAP=0 for
# the sequential serial→lowconc→main baseline (ONE-KEY ROLLBACK).
PHASE_OVERLAP="${QUAY_PHASE_OVERLAP:-1}"

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

# bucket_test_concurrency <args...> — the EFFECTIVE concurrency for the --buckets run({files})
# runner (suite-lpt-runner.mjs). An explicit --test-concurrency=N in args wins (single source, the
# SAME precedence as has_explicit_concurrency); otherwise the derived default. Returns the VALUE —
# the runner needs a number in execArgv (`node --test-concurrency=N`), not the boolean
# has_explicit_concurrency answers. The runner reads that SAME execArgv value for run()'s
# concurrency, and measure-suite-reporter.mjs reads it too ⇒ one source, no drift.
bucket_test_concurrency() {
  local a
  while [ "$#" -gt 0 ]; do
    a="$1"; shift
    case "$a" in
      --test-concurrency=*)
        a="${a#--test-concurrency=}"
        if [[ "$a" =~ ^[0-9]+$ ]] && [ "$a" -ge 1 ]; then printf '%s' "$a"; return 0; fi
        ;;
      --test-concurrency)
        if [ "$#" -gt 0 ] && [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ]; then printf '%s' "$1"; return 0; fi
        shift
        ;;
    esac
  done
  default_test_concurrency
}

# resource_gate_check — extracted to plugin/scripts/runner-static-gate.ts (gap-ac128-hub-split-harness-concerns),
# sourced above alongside run_static_checks.
# ── single-flight lock, S slots (gap-resource-gate-no-single-flight-lock-two-suite-overlap →
#     gap-single-flight-lock-2-slot-concurrent-suites + gap-suite-concurrency-ff-gate-and-slot-ssot) ──
# full_suite_lock — an S-slot counting semaphore over S SHARED lock files
# (`<git-common-dir>/full-suite.lock.0` .. `.S-1`), each held for the ENTIRE full-suite run. The slot
# COUNT IS GENERATED from the QUAY_MAX_CONCURRENT_SUITES knob (旋钮②) by the bash canonical
# (plugin/scripts/suite-slot-lib.sh, the SAME single definition point as the TS side
# plugin/scripts/suite-lock-slots.ts): S=1 ⇒ 仅 `.0`, S=3 ⇒ `.0/.1/.2`, S=2 ⇒ `.0`/`.1`. The old
# implementation wrote TWO lock files (`.0`/`.1`) regardless of S — 注释断言「slot count IS the
# QUAY_MAX_CONCURRENT_SUITES knob」而实现没有 (硬规则③b), 现在实现与注释一致 (人 2026-08-18「把系统真正做对」).
# COMPLEMENTARY to the resource gate: the gate prevents "starting into a busy machine" (a load check
# at startup), the lock prevents "a (S+1)-th suite joining" (mutual exclusion among the S allowed
# suites). Together they are complete — up to QUAY_MAX_CONCURRENT_SUITES full suites can now run
# concurrently (the spec-11 pilot's finding: ≥2 concurrent suites were structurally blocked by the old
# 1-slot lock), and one more can no longer both see GO in a low-load window and start (the 2026-08-07
# incident: two cc8 suites ran simultaneously in DIFFERENT worktrees, 16 workers + subprocesses on 4
# cores, PSI cpu avg10 = 86.22).
#
# The lock is file-descriptor-based (one FD per slot, allocated dynamically via `exec {fd}>file`): the
# FDs are opened once and held open for the whole run, so the lock releases automatically when this
# process exits — even on an error abort — with no trap bookkeeping (flock's crash-autorelease is
# PRESERVED: a dead suite can never leak a slot). Acquire tries each slot NON-BLOCKING (`flock -n`); if
# ALL S are held it WAITs for EITHER to release (bounded per-attempt flock-wait, re-checking all after
# each) — an UNBOUNDED queue wait, never a fail-closed timeout (gap-single-flight-lock-timeout-double-
# value: the old FULL_SUITE_LOCK_TIMEOUT 600s default + the fan-in 900s override were two values on one
# lock, and the 600s line was crossed by the now-normal 819-1619s full-bucket suite — a live suite got
# fail-closed「not starting」). Correctness (never a (S+1)-th GO) is flock-guarded; liveness (never an
# infinite hang) is crash-autorelease for a dead holder + the runner's SUITE_SILENCE_MS/SUITE_MAX_RUNTIME_MS
# and the fan-in stuck-holder reaper for a hung-but-alive holder.
#
# Scoped paths (--for-task, --scoped, --group <non-default>, explicit files) never take the lock —
# they are the verification path that must stay usable while a full suite runs. Nested runners skip
# via the SAME escape hatch the resource gate uses (QUAY_TEST_SKIP_RESOURCE_GATE=1) plus the
# same-root QUAY_TEST_NESTED guard (a nested test.sh spawned inside the running suite must not
# deadlock against the suite's own lock).
# SHARED lock files: resolve via git's COMMON dir so every worktree of this repo AND the primary
# checkout contend on the SAME locks — the 2026-08-07 incident was two DIFFERENT worktrees each
# running a cc8 suite, and a per-checkout `.quay/full-suite.lock` would NOT have serialized them.
# git-common-dir resolves to the main repo's `.git` from any worktree, so
# `<git-common-dir>/full-suite.lock.0`..`.S-1` are the same inodes everywhere. Fall back to
# `<repo_root>/.git` when git is unavailable (a non-git copy).
# `FULL_SUITE_LOCK_FILE=<path>` (the pilot's per-worktree escape) still works — the `.0`..`.S-1`
# suffixes are appended, so a per-worktree override yields a per-worktree S-slot lock.
# (suite-slot-lib.sh is sourced ABOVE, before the derivation functions — the S single-source
# gap-suite-concurrency-S-two-source-divergence fix; the slot paths below reuse that same canonical.)
FULL_SUITE_LOCK_DIR="$(git rev-parse --git-common-dir 2>/dev/null || true)"
if [ -z "${FULL_SUITE_LOCK_DIR}" ]; then
  FULL_SUITE_LOCK_DIR="${repo_root}/.git"
fi
FULL_SUITE_LOCK_FILE="${FULL_SUITE_LOCK_FILE:-${FULL_SUITE_LOCK_DIR}/full-suite.lock}"
# S slot paths + dynamically-allocated FDs (the bash canonical suite-slot-lib.sh generates the count
# from 旋钮②; FDs are allocated at acquire time and kept in FULL_SUITE_LOCK_FDS for the run).
FULL_SUITE_LOCK_SLOTS=()
while IFS= read -r _suite_slot; do FULL_SUITE_LOCK_SLOTS+=("${_suite_slot}"); done < <(suite_slot_paths "${FULL_SUITE_LOCK_FILE}")
FULL_SUITE_LOCK_FDS=()

# Lock-hold cap (gap-suite-lock-starvation-long-validation-hold AC1): a validation-type long task
# (e.g. serial/lowconc re-check runs — 33 files × N re-runs, 5.2h wall) must not hold a single-flight
# slot for hours, starving every other fan-in. FULL_SUITE_LOCK_HOLD_MAX_S (default 1800s = 30min) caps
# the hold: when the suite STILL holds its slot after T seconds, a watchdog child (part of THIS process
# tree — the release must live in the holding process, ⛔ NOT a worker-driver kill) releases the slot and
# records a fail-loud `lock_hold_exceeded=1` marker (never silent). The cap only yields the SLOT — the
# long suite keeps running (it already passed the resource gate at startup); it accepts the contention
# risk of a (S+1)-th suite joining rather than serializing the whole repo behind its re-check.
FULL_SUITE_LOCK_HOLD_MAX_S="${FULL_SUITE_LOCK_HOLD_MAX_S:-1800}"

# full_suite_lock_acquire — acquire one of the S single-flight slots (non-blocking try on each;
# all busy ⇒ unbounded wait for any to release — never fail-closed, see the lock comment above).
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
  local _s_fd _s_slot _s_idx _s_held="" _s_lock_start_ms="" _s_lock_end_ms=""
  FULL_SUITE_LOCK_FDS=()
  # Open EVERY slot file on its own dynamically-allocated FD (append mode: the file exists + is
  # writable even if empty). FD-based flock auto-releases on process exit — a crash/abort cannot leak.
  for _s_slot in "${FULL_SUITE_LOCK_SLOTS[@]}"; do
    exec {_s_fd}>"${_s_slot}"
    FULL_SUITE_LOCK_FDS+=("${_s_fd}")
  done
  # gap-verification-round-observability-holes AC1 (fan-in path) — measure the flock wait from the
  # lock START marker to the acquired marker (EPOCHREALTIME, µs→ms) so the real landing writer
  # pre-verified-round-record.ts can record lock_wait_ms. full-suite-runner derives the SAME value
  # from its live stream markers; the fan-in log is a post-hoc file with no wall timestamps, so
  # test.sh must emit it. Only on a REAL acquire (the skip branches returned above) — scoped/nested
  # runs stay marker-less (缺键, not a fabricated 0).
  _s_lock_start_ms="${EPOCHREALTIME:-}"
  echo "== single-flight lock (${#FULL_SUITE_LOCK_SLOTS[@]} slots — gap-single-flight-lock-2-slot-concurrent-suites + SSoT) =="
  # Non-blocking try over every slot: a free slot is taken immediately (AC1: the 2nd suite starts
  # instead of being serialized).
  _s_idx=0
  for _s_fd in "${FULL_SUITE_LOCK_FDS[@]}"; do
    if flock -n "${_s_fd}"; then _s_held="${_s_idx}"; break; fi
    _s_idx=$((_s_idx + 1))
  done
  if [ -z "${_s_held}" ]; then
    # ALL S slots busy — WAIT for ANY to release (an S-slot counting semaphore made of S flocks).
    # Unbounded queue wait, never a fail-closed timeout: correctness (no (S+1)-th GO) is flock-guarded,
    # liveness is crash-autorelease for a dead holder + the runner's SUITE_SILENCE_MS/SUITE_MAX_RUNTIME_MS
    # and the fan-in stuck-holder reaper for a hung-but-alive holder (gap-single-flight-lock-timeout-
    # double-value: the old 600s/900s timeout misfired on the now-normal 819-1619s suite). Bounded
    # per-attempt flock-wait (1s per slot, re-checking all after each) so a release on ANY slot is
    # picked up promptly.
    while [ -z "${_s_held}" ]; do
      _s_idx=0
      for _s_fd in "${FULL_SUITE_LOCK_FDS[@]}"; do
        if flock -w 1 "${_s_fd}"; then _s_held="${_s_idx}"; break; fi
        _s_idx=$((_s_idx + 1))
      done
    done
  fi
  FULL_SUITE_LOCK_HELD="${_s_held}"
  FULL_SUITE_LOCK_ACQUIRED_MS="${EPOCHREALTIME:-}"
  echo "scripts/test.sh: acquired full-suite single-flight slot ${_s_held} (${FULL_SUITE_LOCK_FILE}.${_s_held}) — held for the entire run"
  if [ -n "${_s_lock_start_ms:-}" ]; then
    _s_lock_end_ms="${EPOCHREALTIME:-}"
    if [ -n "${_s_lock_end_ms:-}" ]; then
      _s_lock_wait_ms="$(awk -v a="${_s_lock_start_ms}" -v b="${_s_lock_end_ms}" 'BEGIN { d = (b - a) * 1000; printf "%d", d < 0 ? 0 : d }')"
      echo "__OVERHEAD__ lock_wait_ms=${_s_lock_wait_ms}" >&2
    fi
  fi
  # Hold-cap watchdog (gap-suite-lock-starvation-long-validation-hold AC1): a child of THIS process
  # (the holder — ⛔ not an outside worker-driver kill) that releases the slot after T seconds of the
  # suite STILL holding, and emits a fail-loud `lock_hold_exceeded=1` marker. The spawn lives in
  # suite-slot-lib.sh (single definition point, sourceable/testable); it polls a flag file each 1s so a
  # normal release (flag removed) or a crash (main pid gone) exits it promptly — no lingering FD.
  FULL_SUITE_LOCK_FLAG="$(mktemp "${TMPDIR:-/tmp}/full-suite-lock-hold.XXXXXX")"
  FULL_SUITE_LOCK_WATCHDOG_PID="$(spawn_suite_lock_hold_watchdog "${FULL_SUITE_LOCK_FDS[${_s_held}]}" "${FULL_SUITE_LOCK_FLAG}" "$$" "${FULL_SUITE_LOCK_HOLD_MAX_S}")"
}

# full_suite_lock_release — release the HELD slot and close all FDs (idempotent; flock also
# auto-releases on exit — a skipped lock is a clean no-op).
full_suite_lock_release() {
  local _r_idx=0 _r_fd _r_now="" _r_hold_ms=""
  # Cancel the hold-cap watchdog: it polls the flag file each 1s, so removing it makes the watchdog
  # exit promptly (its inherited FD closes, no lingering process). Idempotent (a skipped lock has no
  # flag — rm -f is a no-op).
  rm -f "${FULL_SUITE_LOCK_FLAG:-}"
  if [ -n "${FULL_SUITE_LOCK_HELD:-}" ]; then
    _r_idx="${FULL_SUITE_LOCK_HELD}"
    if [ "${_r_idx}" -lt "${#FULL_SUITE_LOCK_FDS[@]}" ]; then
      flock -u "${FULL_SUITE_LOCK_FDS[${_r_idx}]}" 2>/dev/null || true
    fi
  fi
  # gap-suite-lock-starvation-long-validation-hold AC2 — emit lock_hold_ms (the acquire→release wall)
  # so the outcome records can distinguish "long lock hold" from "worker slow": lock_wait_ms is the
  # queued-wait half, lock_hold_ms is the held half. Absent on scoped/nested runs (no lock taken —
  # 缺键, never a fabricated 0).
  if [ -n "${FULL_SUITE_LOCK_ACQUIRED_MS:-}" ]; then
    _r_now="${EPOCHREALTIME:-}"
    if [ -n "${_r_now:-}" ]; then
      _r_hold_ms="$(awk -v a="${FULL_SUITE_LOCK_ACQUIRED_MS}" -v b="${_r_now}" 'BEGIN { d = (b - a) * 1000; printf "%d", d < 0 ? 0 : d }')"
      echo "__OVERHEAD__ lock_hold_ms=${_r_hold_ms}" >&2
    fi
  fi
  for _r_fd in "${FULL_SUITE_LOCK_FDS[@]}"; do
    eval "exec ${_r_fd}>&-" 2>/dev/null || true
  done
  FULL_SUITE_LOCK_FDS=()
}

# ── group resolution helpers (gap-test-suite-has-no-layer-grouping) ──────────────────────────────
# group_of / check_group_declarations / effective_groups / in_group / is_default_set / select_files /
# list_groups extracted to plugin/scripts/runner-grouping.ts (gap-suite-hub-file-responsibility-strip):
# the grouping mechanism decides WHICH tests run, so it is a HUB file (a change still forces the full
# suite — the `runner-grouping*` glob in suite-bucket-hub-list.ts HUB_FILES matches it). Sourced here so
# the dispatch path below keeps calling them by name; behavior is byte-identical.
source "${repo_root}/plugin/scripts/runner-grouping.ts"

# build_deduped_files — echo the union glob, deduped by realpath (AC3). One file per line.
# DELIBERATELY KEPT HERE (not moved to runner-grouping.ts): its canonical test-glob declaration line
# is the ADR-004 SINGLE-SOURCE that FOUR checkers parse from scripts/test.sh
# (test-framework-policy-check.ts / test-coverage-check.ts / test-impl-census-check.ts /
# test-group-downgrade-check.ts) — moving it would break their glob derivation (0 files). The moved
# functions call it by NAME (bash resolves at call time, so this later definition is fine).
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

# lpt_reorder_files <name-ref> — LPT-reorder the named array IN PLACE (longest-KNOWN first)
# (gap-m-bucket-long-tail-lpt-scheduling + gap-suite-lpt-full-bucket-run-selected). Shared by the
# --buckets M-bucket path AND the run_selected full-suite default path (bucket_full=1 + the no-args
# full entry), so the LPT ordering has ONE definition point — never two inline copies that drift.
# Durations come from the EXISTING carrier .quay/verification-round.jsonl perFile[].durationMs
# (rolling average of the last QUAY_TEST_LPT_ROUNDS rounds) — no new measurer. Scheduling-only:
# every file is emitted exactly once, so a bug can never drop a test (pass/fail-neutral). FAIL-OPEN:
# no history / helper failure / a short result ⇒ keep the original order. QUAY_TEST_LPT_ORDER=0 is
# the one-key rollback. Callers hand the array NAME (nameref) so the reorder lands back in the
# caller's own array (mapfile on the nameref writes through to the referenced variable).
lpt_reorder_files() {
  local -n _lpt_arr="$1"
  if [ "${QUAY_TEST_LPT_ORDER:-1}" = "1" ] && [ "${#_lpt_arr[@]}" -gt 1 ]; then
    local _lpt_out
    _lpt_out="$(printf '%s\n' "${_lpt_arr[@]}" | node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/suite-lpt-order.ts" --root "${main_root}" --rounds "${QUAY_TEST_LPT_ROUNDS:-3}")" || _lpt_out=""
    if [ -n "${_lpt_out}" ] && [ "$(printf '%s\n' "${_lpt_out}" | wc -l)" -eq "${#_lpt_arr[@]}" ]; then
      mapfile -t _lpt_arr <<< "${_lpt_out}"
      echo "scripts/test.sh: lpt-order: file list reordered (${#_lpt_arr[@]} files; first=$(basename "${_lpt_arr[0]}"))" >&2
    fi
  fi
}

# run_selected <groups-csv> [extra-node-flags...] — build the selected file list and exec node
# --test. Runs the split-or-commit whole-store scan first (same invariant as the default/no-args
# path). Extra flags (from the flags-only form) are PREPENDED to the file list; node --test is
# last-flag-wins, so a user --test-concurrency=N still overrides the derived default.
# ── Fixed-overhead instrumentation (gap-suite-fixed-overhead-decomposition, AC1/AC2) ───────────────
# The _oh_* timing family (mark / emit / partial-fallback) was extracted to plugin/scripts/overhead-instrument.sh
# (gap-suite-hub-file-responsibility-strip): overhead timing is PURE TELEMETRY — changing it never flips
# pass/fail — so it is a NON-hub file. Sourced here; the `__OVERHEAD__` output stays byte-identical.
source "${repo_root}/plugin/scripts/overhead-instrument.sh"

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
  # archguard structural gate (gap-archguard-zero-production-calls): a REAL archguard CLI call wired
  # into the suite — fail-closed (archguard missing / analyze failed / dependency cycles ⇒ exit 1).
  # This is the mechanism that makes CLAUDE.md's「Consult archguard before calling a milestone done」
  # executable instead of advisory: the meter is runnable, not asserted (AC1/AC2); the produced
  # `.archguard/` product is read back as the criterion's input and appended to
  # `.archguard/metrics-history.jsonl` (AC3). Runs AFTER the parallelized static-check block (the
  # archguard analyze is CPU-heavy tree-sitter work, kept out of the parallel pool to avoid contention).
  run_checker "archguard-structure-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/archguard-runner.ts" --root "${repo_root}"
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
  # The main phase's concurrency is delivered via bucket_test_concurrency (explicit flag wins, else
  # the derived default) — NOT the `--test-concurrency="$(default_test_concurrency)"` literal, whose
  # spelling is pinned by plugin/test/resource-gate.test.mjs AC5 (exactly 5 sites) and
  # select-tests-for-touches.test.mjs AC11; the default-path branch must not add a sixth literal site.
  if [ "${FULL_SUITE_DEFAULT:-0}" = "1" ]; then
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
    # LOWCONC selection hoisted BEFORE the serial run so the overlap branch can launch both phases in
    # parallel. In the SEQUENTIAL branch the lowconc selection used to run right before the lowconc
    # phase; hoisting it here shifts that selection time into gap_ms_pre_to_serial (a diagnostic gap,
    # NEVER a phase metric) — serial_phase_ms / lowconc_phase_ms / main_phase_ms are unchanged, so the
    # before/after comparison metric (serial_phase_ms + lowconc_phase_ms, task constraint 3) is byte-
    # identical between this and the pre-change sequential scheduling.
    local lowconc_files=() lf lowconc_code
    while IFS= read -r lf; do lowconc_files+=("$lf"); done < <(select_files "lowconc")
    # PHASE OVERLAP (gap-phase-overlap-two-phase-parallel-exploration AC1, default-ON since AC101):
    # when QUAY_PHASE_OVERLAP=1 (the default) AND both phases are non-empty, run serial + lowconc in
    # PARALLEL (each at its OWN concurrency, $SERIAL_CONCURRENCY / $LOWCONC_CONCURRENCY — scheduling-
    # only, never a value change, AC4). Set QUAY_PHASE_OVERLAP=0 for the sequential baseline
    # (ONE-KEY ROLLBACK). Expected saving: the sequential serial+lowconc window (177+154=331s)
    # becomes max(177,154)≈177s.
    if [ "$PHASE_OVERLAP" -eq 1 ] && [ "${#serial_files[@]}" -gt 0 ] && [ "${#lowconc_files[@]}" -gt 0 ]; then
      [ "$oh_full" -eq 1 ] && oh_t5=$(_oh_mark)
      echo "overlap: running ${#serial_files[@]} serial + ${#lowconc_files[@]} lowconc files in parallel (serial conc=$SERIAL_CONCURRENCY, lowconc conc=$LOWCONC_CONCURRENCY)"
      local serial_pid lowconc_pid overlap_s_start overlap_l_start overlap_s_end overlap_l_end
      # Per-process sub-times + per-phase completion markers for the runner's phase accounting
      # (gap-verification-round-phases-overlap-merged AC1/AC2): the two phases run in PARALLEL, so
      # the stream's __GROUP__ lines cannot be attributed to one or the other. Emitting
      # `__OVERHEAD__ overlap_<phase>_done=1` right after each `wait` gives the runner an explicit
      # "this parallel phase finished" signal — the combined window closes only when BOTH have fired,
      # and `overlap_<phase>_ms=N` carries each phase's OWN wall sub-time so the serial/lowconc
      # contributions stay distinguishable (the fixed-overhead serial_phase_ms stays the combined
      # window — the analyst's serial+lowconc sum == the window, unchanged for the before/after metric).
      overlap_s_start=$(_oh_mark)
      node --test --test-concurrency="$SERIAL_CONCURRENCY" $(suite_reporter_flags) "${serial_files[@]}" & serial_pid=$!
      overlap_l_start=$(_oh_mark)
      node --test --test-concurrency="$LOWCONC_CONCURRENCY" $(suite_reporter_flags) "${lowconc_files[@]}" & lowconc_pid=$!
      wait "$serial_pid"; serial_code=$?
      overlap_s_end=$(_oh_mark)
      echo "__OVERHEAD__ overlap_serial_ms=$((overlap_s_end - overlap_s_start))" >&2
      echo "__OVERHEAD__ overlap_serial_done=1" >&2
      wait "$lowconc_pid"; lowconc_code=$?
      overlap_l_end=$(_oh_mark)
      echo "__OVERHEAD__ overlap_lowconc_ms=$((overlap_l_end - overlap_l_start))" >&2
      echo "__OVERHEAD__ overlap_lowconc_done=1" >&2
      [ "$serial_code" -eq 0 ] || code="$serial_code"
      [ "$lowconc_code" -eq 0 ] || code="$lowconc_code"
      # Overlap timing: the two phases share ONE window. serial_phase_ms = the combined window and
      # lowconc_phase_ms = 0 (subsumed — the analyst's serial+lowconc sum == the overlap window).
      # gap_ms_serial_to_lowconc = 0 (no transition gap by construction).
      [ "$oh_full" -eq 1 ] && { oh_t5b=$(_oh_mark); oh_t6="$oh_t5b"; oh_t6b="$oh_t5b"; }
    else
      # SEQUENTIAL baseline (unchanged scheduling). Timing markers preserve the historical semantics:
      # oh_t5 = after serial selection / before serial, oh_t5b = after serial, oh_t6 = after lowconc
      # selection / before lowconc, oh_t6b = after lowconc.
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
      [ "$oh_full" -eq 1 ] && oh_t6=$(_oh_mark)
      if [ "${#lowconc_files[@]}" -gt 0 ]; then
        echo "selected ${#lowconc_files[@]} files (groups=lowconc)"
        node --test --test-concurrency="$LOWCONC_CONCURRENCY" $(suite_reporter_flags) "${lowconc_files[@]}"
        local lcode=$?
        [ "$lcode" -eq 0 ] || code="$lcode"
      fi
      [ "$oh_full" -eq 1 ] && oh_t6b=$(_oh_mark)
    fi
    # MAIN phase (the concurrency-N default body) — runs LAST, after serial/lowconc
    # (gap-phase-order-serial-lowconc-before-main): a serial/lowconc failure is now judged red at
    # the phase boundary, never after the entire main phase's cost has been paid.
    # LPT order + order-preserving run({files}) (gap-suite-lpt-full-bucket-run-selected): the main
    # body is LPT-reordered longest-known-first and handed to suite-lpt-runner.mjs — the ONLY path
    # that preserves argv order (node --test re-sorts positional globs alphabetically, which is how
    # the full default path previously ran the main body: longest files serialized at the tail).
    # Concurrency rides in execArgv via bucket_test_concurrency (explicit flag wins, else the derived
    # default — the SAME single-concurrency-source precedence as has_explicit_concurrency), and the
    # runner composes spec→stdout + measure-suite-reporter→stderr (the suite_reporter_flags
    # equivalents), so the per-file attribution + LPT input carrier stay intact.
    local mcode=0
    lpt_reorder_files files
    node --test-concurrency="$(bucket_test_concurrency "$@")" "${repo_root}/plugin/scripts/suite-lpt-runner.mjs" "$@" "${files[@]}"
    mcode=$?
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
    # BOUNDED REAP-WAIT (gap-leak-scan-reap-race-false-red): the wait-before-judgment lives INSIDE
    # --check — when NEW matches appear it polls up to $TMUX_LEAK_REAP_WAIT_MS (default: host-derived
    # reap_wait_default() in tmux-leak-scan.sh, ≥10000) for
    # them to clear before declaring a leak, so test-spawned tmux servers still exiting at run end
    # (round 95 false-red: tests=4150 all pass) are not swept as residue. A genuine leak persists
    # past the bound and still fails. A clean run adds zero latency (first scan wins immediately).
    # TRUE-CATCH-ALL registry kill (gap-session-liveness-teardown-ol-scd-cf-leak): BEFORE the suite-tail
    # leak scan, kill any STILL-ALIVE server the session-liveness family registered durably. Closes the
    # process-crash / cancelled-test hole — a test process that died before its after() hook can never
    # clean its server, but the durable registry (written at server-creation) survives. Registry-driven
    # (PID-targeted SIGKILL of servers the tests self-built), NEVER a name-based batch kill (invariant
    # no_pkill_by_name_on_live = 1). Best-effort (exit 0 always) — the leak-scan is the assertion.
    node --experimental-strip-types "${repo_root}/plugin/scripts/session-liveness-sweep-kill.mjs" || true
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
elif [ "${1:-}" = "--static-checks-doc" ]; then
  # Doc-class static checks only (AC51 断言面拆分, gap-ac51-assertion-surface-split): run the
  # DOC-ONLY checkers (run_doc_checks) with NO test run. This is the pre-commit home of the doc
  # consistency checks — wired into plugin/scripts/precommit-guard.ts (the pre-commit hook invokes
  # `bash scripts/test.sh --static-checks-doc` at commit time). It is NOT part of the full-suite
  # gate; the full suite runs run_static_checks (code-class only).
  run_doc_checks
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
elif [ "${1:-}" = "--buckets" ]; then
  # gap-ac124-suite-bucket-production-carrier-benefit: bucket-level test selection (the phase's
  # coarser granularity than --for-task). `scripts/test.sh --buckets <task-id>` delegates to
  # suite-bucket-select.ts, which resolves the task's ## Touches to a bucket set via AC120 attribution
  # + AC121 reattribution + AC122 hub fallback + AC123 both-sides, and runs the bucket subset:
  #   hub touch  ⇒ FULL suite (unconditional, no fan-out)
  #   P-only     ⇒ P bucket; M-only ⇒ M bucket; P+M ⇒ both; UNRESOLVED always selected (safe side)
  #   no bucket  ⇒ FULL suite (fail-closed — an unclassifiable code change must not look like "nothing")
  # FULL static checks ALWAYS run (the bucket is about TEST FILES, never a static-check frequency cut —
  # phase-goal "按变更选桶,不是降频"). Emits a __BUCKETS__ marker line (bucket + file count + full flag)
  # that full-suite-runner.ts carries into the verification-round record.
  bucket_id="${2:-}"
  if [ -z "${bucket_id}" ]; then
    echo "scripts/test.sh: --buckets requires a task id" >&2
    exit 2
  fi
  shift 2
  rest_args=()
  for a in "$@"; do rest_args+=("${a}"); done
  bucket_summary="$(node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/suite-bucket-select.ts" --root "${repo_root}" --task "${bucket_id}" --summary)" || {
    echo "scripts/test.sh: --buckets ${bucket_id} — bucket selector failed (exit $?)" >&2
    exit 2
  }
  bucket_full="$(printf '%s' "${bucket_summary}" | sed -n 's/.*full=\([01]\).*/\1/p')"
  bucket_buckets="$(printf '%s' "${bucket_summary}" | sed -n 's/.*buckets=\([^ ]*\).*/\1/p')"
  bucket_files="$(printf '%s' "${bucket_summary}" | sed -n 's/.*files=\([0-9][0-9]*\).*/\1/p')"
  echo "__BUCKETS__ buckets=${bucket_buckets} files=${bucket_files} full=${bucket_full}"
  if [ "${bucket_full}" = "1" ]; then
    # Hub touch / no-bucket-triggerable ⇒ the full default suite (run_selected exits).
    run_selected "$(effective_groups)"
  fi
  bucket_sel_out="$(node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/suite-bucket-select.ts" --root "${repo_root}" --task "${bucket_id}" --paths-only)"
  if [ -z "${bucket_sel_out}" ]; then
    echo "scripts/test.sh: --buckets ${bucket_id} — selector selected 0 test files (bucket=${bucket_buckets}); falling back to full suite" >&2
    run_selected "$(effective_groups)"
  fi
  mapfile -t files <<< "${bucket_sel_out}"
  # LPT order (gap-m-bucket-long-tail-lpt-scheduling): reorder the M-bucket file list longest-known-
  # first — the mechanism lives in lpt_reorder_files() (single definition point, shared with the
  # run_selected full-suite default path via gap-suite-lpt-full-bucket-run-selected).
  lpt_reorder_files files
  # AC3 (gap-suite-serial-lowconc-classification-recheck 单飞锁侧): the bucket SUCCESS path
  # (non-hub, non-zero selection) structurally bypasses run_selected() — where
  # full_suite_lock_acquire() lives — so QUAY_MAX_CONCURRENT_SUITES=1 never applied to bucket runs
  # (round #572 M-bucket lock_wait_ms key missing vs #573 full overlap 5min). Acquire the
  # single-flight lock HERE (before static checks + build, matching run_selected's lock-first
  # order), so a bucket suite contends on the SAME S-slot lock as a full suite. The lock's own
  # skip guards (QUAY_TEST_SKIP_RESOURCE_GATE=1 / nested) still hold — this runs before
  # mark_nested below, so a top-level bucket run acquires while a nested one (outer already holds
  # the slot) skips. FD-based flock auto-releases on `exit "${bucket_code}"` below — no explicit
  # release needed (same crash-autorelease guarantee as the full path).
  full_suite_lock_acquire
  # FULL static checks (verification-grade — no 降频), then the bucket test subset.
  run_static_checks
  build_dist_once
  # Suite-tail leak scan on the bucket path (gap-bucket-subset-tmux-leak-scan-missing): the
  # tmux-leak-scan --snapshot/--check delta pair + session-liveness-sweep-kill is a PER-ROUND
  # checker, NOT 全量专属 — a bucket subset that skips it drops the checker from every-round to
  # never-run (降频 violation). Snapshot failure is non-fatal (the absolute --check still runs).
  bash "${repo_root}/plugin/scripts/tmux-leak-scan.sh" --snapshot "${repo_root}" || true
  mark_nested
  set +e
  # Per-file attribution + LPT-preserving run (gap-fix-scope-perfile-buckets-parser +
  # gap-m-bucket-long-tail-lpt-scheduling): hand the LPT-ordered file list to suite-lpt-runner.mjs,
  # which calls node:test run({files}) — the ONLY path that preserves argv order (the node --test
  # CLI re-sorts positional globs alphabetically). The runner composes BOTH reporters via
  # stream.compose: spec → stdout (判绿 markers) and measure-suite-reporter → stderr
  # (__PERFILE__ duration_ms=<d> <path> passed=<bool> — the fix-scope gate's per-file attribution
  # AND the LPT ordering's own input carrier; if this breaks the per-file duration data goes dark
  # and LPT has no input ⇒ self-defeating). Concurrency rides in execArgv (--test-concurrency=N)
  # so the reporter's readConcurrency() sees the SAME value (single source, no drift).
  node --test-concurrency="$(bucket_test_concurrency "${rest_args[@]}")" "${repo_root}/plugin/scripts/suite-lpt-runner.mjs" "${rest_args[@]}" "${files[@]}"
  bucket_code=$?
  # Same suite-AFTER tail as the full default path: session-liveness-sweep-kill is the best-effort
  # TRUE-CATCH-ALL registry kill (exit 0 always); the --check assertion is the leak verdict and
  # merges into the exit code so a bucket-round leak still reports `tmux-leak-scan: FAIL`.
  node --experimental-strip-types "${repo_root}/plugin/scripts/session-liveness-sweep-kill.mjs" || true
  if ! bash "${repo_root}/plugin/scripts/tmux-leak-scan.sh" --check "${repo_root}"; then
    bucket_code=1
  fi
  set -e
  exit "${bucket_code}"
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
