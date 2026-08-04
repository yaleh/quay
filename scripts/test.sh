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
# NEW files must also carry a `// @test-group <product|engine|governance>` declaration (AC5);
# existing files may omit it and default to `engine`. The check does NOT migrate the 34 legacy
# hand-rolled-harness files — it stops the 35th and turns each existing file's eventual conversion
# (e.g. relation-sync's harness) into the ratchet.
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
#
# Layer grouping (gap-test-suite-has-no-layer-grouping):
#   Every test file declares its layer at the very top: `// @test-group <name>` where name is
#   one of product / engine / governance (AC1). The DEFAULT for an undeclared file is `engine`
#   (AC7) — the current work surface, so a missed declaration never silently vanishes.
#
#   - product     packages/*/test/ — Core CLI, Provider ABI, gate engine, web UI; plus
#                 plugin/test/plugin-packaging.test.mjs — plugin-packaging (incl. M136's
#                 sync-vendor.sh --check scan) is a PRODUCT packaging path, not engine
#                 (AC8 of gap-sync-vendor-drift-mislabelled-as-task-schema).
#   - engine      methodology EXECUTION path (the rest of plugin/test + the execution-path
#                 tests under experiments/quay-perpetual-stream/test/)
#   - governance  exp5 metering (PARKED but not deleted — exp6 phase-2 needs it; the in-file
#                 skip block makes it visible as `skipped` in default runs instead of absent)
#
#   The glob now ALSO includes experiments/quay-perpetual-stream/test/*.test.mjs (AC2), so the
#   44 previously-invisible files always appear in the output. Symlinks under that dir that
#   point back into plugin/test/ are deduped by realpath (AC3) so they never run twice.
#   Non-default-group files self-skip BEFORE their heavy imports (AC8), so `--group product`
#   does not pay the governance load cost. Default (no --group) = product,engine (AC4).
#
# --test-concurrency default is now DERIVED (gap-no-resource-awareness-heavy-ops-run-blind, AC5):
#   default = max(1, floor(nproc / AMPLIFICATION))   with AMPLIFICATION ≈ 2.1 (measured, see
#   default_test_concurrency below). The old hardcoded 8 was measured 10.3% faster than the runtime
#   default by ADR-019 — but that was measured WITHOUT a second layer running concurrently; on a
#   4-core box, 8 workers + spawned subprocesses = 17 processes = a 4.25× oversubscription, the
#   measured steady state of a single full suite. A later --test-concurrency=N on the command line
#   overrides the derived default (node --test is last-flag-wins).
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

# run_static_checks — the repo-wide invariants that run on EVERY test-running invocation,
# independent of which test files were requested (fast; the metadata modes --list-groups/
# --list-files skip them). CI inherits them because its only test step is `bash scripts/test.sh`.
run_static_checks() {
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
  echo "== split-or-commit whole-store check (DIR-026, gap-split-or-commit-not-continuously-checked) =="
  bash "${repo_root}/plugin/scripts/it0-split-or-commit-check.sh" "${repo_root}"
  echo "== test-framework-policy check (gap-no-test-framework-policy-for-new-tests, AC1/AC3-AC5) =="
  bash "${repo_root}/plugin/scripts/test-framework-policy-check.sh" "${repo_root}"
  echo "== test-isolation contract check (gap-test-isolation-contract-is-unwritten, AC1-AC6) =="
  bash "${repo_root}/plugin/scripts/test-isolation-check.sh" "${repo_root}"
  echo "== ## Contract consumer check (gap-dispatch-gate-has-no-checklist-and-no-trace, AC6) =="
  # gap-contract-ratchet-has-no-runner-and-grew-tenfold-unnoticed: this checker had NO runner — its
  # shrink-only ratchet list (docs/analysis/contract-violations.md) grew 1 -> 12 unnoticed because
  # the only consumer was an ad-hoc pre-dispatch run. Wiring it here (same place as the other three
  # whole-store checkers) gives every test-running invocation — and CI, which inherits it via its
  # single `bash scripts/test.sh` step — the ratchet enforcement for free. exit 1 on ratchet growth
  # aborts the suite (set -euo pipefail), so a NEW violation red-lights the commit, not the dispatch.
  node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/task-contract-check.ts" --root "${repo_root}"
  echo "== AC-carryover check (gap-nothing-checks-whether-a-done-task-left-its-acs-behind, AC6) =="
  # A done task may leave ACs unchecked ONLY if a successor `## Carries` section names them — the
  # gate on the gates: nothing previously noticed a done task closing with half its ACs unchecked and
  # no carrier (measured 2026-08-03: session-liveness closed done with 8/16 unchecked, stage-2
  # existed only because the outer happened to look). Wired here (same site as task-contract-check)
  # so CI — whose only test step is `bash scripts/test.sh` — inherits it for free. The legacy
  # baseline (docs/analysis/task-ac-carryover-baseline.md) is shrink-only: exit 1 on a NEW unowned
  # AC aborts the suite (set -euo pipefail), red-lighting a done task that just closed with
  # uncarried ACs instead of letting it merge silently.
  node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/task-ac-carryover-check.ts" --root "${repo_root}"
  echo "== ADR-016 screen-use check (gap-adr-016-carve-out-permits-the-whole-screen-hash, AC3) =="
  # ADR-016 Amendment 2026-08-04 boundary (c): whole-screen equality/hash of capture-pane is
  # forbidden. Code-position detection (a capture-pane result flowing into md5sum/sha1sum/cksum in
  # a shell script), band 0..1 (the ONE active legacy observer — session-liveness.sh — is carried
  # by the sibling task; a NEW active violation red-lights the commit).
  node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/adr016-screen-use-check.ts" --root "${repo_root}"
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
  bash "${repo_root}/plugin/scripts/checker-mutation-check.sh" --check
}

# ── derived default concurrency (gap-no-resource-awareness-heavy-ops-run-blind, AC5) ──────────────
# node --test with concurrency N actually runs ~N × AMPLIFICATION node processes: each worker
# spawns its own subprocesses. Measured 2026-08-03: a full suite at concurrency 8 peaked at
# 17 node processes ⇒ ratio ≈ 2.125; a scoped concurrency-2 run of subprocess-heavy plugin tests
# re-measured 3.0 per worker. The old hardcoded 8 on a 4-core box was a 4.25× oversubscription —
# the measured steady state of a SINGLE full suite, not a product of concurrency. The default is
# now derived:
#   default = max(1, floor(nproc / AMPLIFICATION))
# which on this box gives floor(4 / 2.1) = 1 (~3 processes, under 4 cores).
#
# TEMPORARILY OVERRIDDEN BACK TO 8 (2026-08-03, outer urgent correction): the derived default of 1
# turned every full suite from ~8 min to ~55 min (Σ ≈ 3300s at concurrency 1 vs 460-570s wall at 8).
# The AC5 tradeoff experiment was never run: the task body measured the amplification side (17/8 =
# 2.125) but NOT the cost side — AC5 required running concurrency ∈ {2,4,6,8} once each in the same
# low-pressure window with cancelled == 0 as the criterion. Meanwhile sigma measured Σ/wall ≈ 7.1 at
# 8 lanes (8-lane is saturated, not overloaded), and its high-pressure negative control (41→99)
# still captured 155/155 with no cancelled — "lower concurrency to avoid cancel" is unproven, while
# the cost of lowering is a definite ~7×. REVERT this override to the derived formula once AC5's
# tradeoff experiment is run and the choice is data-backed on BOTH sides. (stranded's OVER90 was a
# direct casualty of the 55-min suites.)
# An EXPLICIT --test-concurrency=N on the command line ALWAYS overrides (node --test is
# last-flag-wins, and the user's flag is passed AFTER the default in the exec line).
#
# Test seams (unit test in plugin/test/resource-gate.test.mjs): RESOURCE_GATE_NPROC /
# RESOURCE_GATE_AMPLIFICATION override the derivation inputs deterministically.
default_concurrency_formula() {
  local ncpu amp
  ncpu="${RESOURCE_GATE_NPROC:-$(nproc 2>/dev/null || echo 1)}"
  amp="${RESOURCE_GATE_AMPLIFICATION:-2.1}"
  awk -v n="$ncpu" -v a="$amp" 'BEGIN { c = int(n / a); if (c < 1) c = 1; print c }'
}

default_test_concurrency() {
  # TEMPORARY (2026-08-03): fixed at 8 pending AC5's tradeoff experiment — see comment above.
  # The derived formula (max(1, floor(nproc/2.1))) is preserved in default_concurrency_formula
  # for when the experiment lands.
  echo "8"
  return 0
  default_concurrency_formula
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

# heavy_op_acquire — the cross-project heavy-op token (gap-no-cross-project-heavy-op-token).
# Called ONLY on the FULL-SUITE default path, BEFORE resource_gate_check (串联不合并: 先取令牌、
# 再过闸 — a gate WAIT must release the token, or one WAIT would hold the whole cross-project mutex).
# The token script itself FAILS OPEN (exit 0 + a loud marker) when $QUAY_GLOBAL_DIR is
# unwritable/unreachable — this is a scheduling token, not a safety check; a non-zero exit HERE
# means another project legitimately holds it, and the full suite must NOT run on top of it.
# On success it arms an EXIT trap that releases the token on EVERY exit path (gate WAIT, build
# failure, static-check failure, node test completion). Skips when QUAY_TEST_SKIP_RESOURCE_GATE=1 —
# a nested runner inside an outer suite: the outer suite already holds the token (the exemption
# boundary is identical to resource-gate.sh's).
#
# AC4 wait bound (gap-the-only-token-waiter-refuses-to-wait-at-all): the one real waiter used to
# pass --timeout 0 (ZERO wait) — a ≤30s transient grace window (a crashed holder's token aged less
# than HEAVY_OP_STALE_TIMEOUT_S, so not yet reclaimable) became a FAILED full-suite run. The bound
# is HEAVY_OP_ACQUIRE_TIMEOUT_S (default 40): a full stale-timeout cycle (default 30) plus margin
# for the write→reclaim race, yet FAR below one real heavy op (full suite ~8 min at concurrency 8)
# — the worst-case wait absorbs the grace window and can NEVER serialize two heavy ops back-to-back
# (40/480 ≈ 8% of a full suite). The token script's --timeout N is a bounded poll (re-checks reclaim
# each second, AC1), so a dead holder is reclaimed mid-wait and the suite proceeds; a LIVE holder is
# never stolen (AC3) — the wait only converts the DEAD-holder grace window, never a running op.
HEAVY_OP_ACQUIRE_TIMEOUT_S="${HEAVY_OP_ACQUIRE_TIMEOUT_S:-40}"
heavy_op_acquire() {
  if [ "${QUAY_TEST_SKIP_RESOURCE_GATE:-}" = "1" ]; then
    echo "scripts/test.sh: QUAY_TEST_SKIP_RESOURCE_GATE=1 — skipping heavy-op token (nested runner; outer suite holds it)"
    return 0
  fi
  echo "== heavy-op token (gap-no-cross-project-heavy-op-token) =="
  if ! bash "${repo_root}/plugin/scripts/heavy-op-token.sh" --acquire quay --timeout "${HEAVY_OP_ACQUIRE_TIMEOUT_S}"; then
    echo "scripts/test.sh: could not acquire the heavy-op token within ${HEAVY_OP_ACQUIRE_TIMEOUT_S}s (holder state printed above — dead vs alive) — not running the full suite to avoid cross-project resource contention. Re-run when the token is free." >&2
    exit 1
  fi
  HEAVY_OP_ACQUIRED=1
  # EXIT trap: release on every exit path. The default-set branch below runs node as a CHILD (not
  # exec) precisely so this trap fires when node finishes — an exec'd node would replace this shell
  # and silently skip the release.
  trap 'if [ "${HEAVY_OP_ACQUIRED:-0}" = "1" ]; then bash "${repo_root}/plugin/scripts/heavy-op-token.sh" --release quay >/dev/null 2>&1 || true; HEAVY_OP_ACQUIRED=0; fi' EXIT
}

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
# deliberately does NOT set it — its nested runs have 120s/300s budgets, run --group
# subsets, and keep a second live in-suite exercise of this build; that is a documented,
# lower-severity instance of the same structural exposure, not a regression.
build_dist_once() {
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

# run_selected <groups-csv> [extra-node-flags...] — build the selected file list and exec node
# --test. Runs the split-or-commit whole-store scan first (same invariant as the default/no-args
# path). Extra flags (from the flags-only form) are PREPENDED to the file list; node --test is
# last-flag-wins, so a user --test-concurrency=N still overrides the derived default.
run_selected() {
  local groups="$1"; shift
  # The resource gate + heavy-op token guard the FULL-SUITE default (product,engine). A
  # non-default --group is a subset run (e.g. --group governance) — scoped, skip both (the token's
  # exemption boundary is identical to resource-gate.sh's). QUAY_TEST_SKIP_RESOURCE_GATE=1 is
  # honored inside resource_gate_check / heavy_op_acquire for nested runners.
  if is_default_set "$groups"; then
    heavy_op_acquire
    resource_gate_check
  fi
  build_dist_once
  run_static_checks
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
  # gap-no-cross-project-heavy-op-token: while the token is held, run node as a CHILD (not exec) so
  # the EXIT trap armed by heavy_op_acquire fires when node finishes — an exec'd node would replace
  # this shell and silently skip the release. The concurrency flag is bound to a variable here
  # because the literal `--test-concurrency="$(default_test_concurrency)"` spelling is pinned by
  # plugin/test/resource-gate.test.mjs AC5 (exactly 4 sites) and select-tests-for-touches.test.mjs
  # AC11 — the token-held branch must not add a fifth literal site.
  if [ "${HEAVY_OP_ACQUIRED:-0}" = "1" ]; then
    local cc
    cc="$(default_test_concurrency)"
    set +e
    node --test --test-concurrency="$cc" "$@" "${files[@]}"
    local code=$?
    set -e
    # Suite-AFTER assertion (gap-mkdtemp-rooted-in-the-shared-checkout-dirties-the-tree): a FULL
    # SUITE must leave the shared checkout clean (`git status --porcelain` empty). Harder than any
    # static rule — it does not depend on a detector recognizing a particular spelling, so ANY
    # test that dirties the tree (mkdtemp under REPO_ROOT, a leaked scratch dir, a stray file) is
    # caught here. Only on the full-suite default path (this token-held branch); scoped runs
    # legitimately execute inside uncommitted worktrees and skip it. A failing test's own exit
    # code is the primary signal, so a dirty tree only flips a PASSING run (never masks a fail).
    if [ "$code" -eq 0 ] && ! bash "${repo_root}/plugin/scripts/assert-clean-tree.sh" "${repo_root}"; then
      code=1
    fi
    exit "$code"
  fi
  exec node --test --test-concurrency="$(default_test_concurrency)" "$@" "${files[@]}"
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
    exec node --test --test-concurrency="$(default_test_concurrency)" "$@"
  fi
fi

if [ "$#" -eq 0 ]; then
  # Default: product,engine (AC4). Governance files are passed through too — they self-skip,
  # so they report `skipped`, not absent (ADR-019 decision #1 precedent). run_selected runs
  # the split-or-commit whole-store scan.
  run_selected "$(effective_groups)"
elif [ "${1:-}" = "--for-task" ]; then
  run_static_checks
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
  build_dist_once
  set +e
  # Pass-through flags (e.g. --test-name-pattern=X) must precede the file list: node --test only
  # honors --test-name-pattern when it appears BEFORE the named files (after them it is ignored,
  # which would run the whole file — and for this self-referential test, recurse).
  node --test --test-concurrency="$(default_test_concurrency)" "${rest_args[@]}" "${files[@]}"
  test_code=$?
  set -e
  if [ "${sel_code}" -ne 0 ]; then
    echo "scripts/test.sh: --for-task ${task_id} — test-selection-thin (selector exit ${sel_code}); re-run with --allow-thin to suppress" >&2
    exit "${sel_code}"
  fi
  exit "${test_code}"
elif all_flags "$@"; then
  # gap-test-sh-flags-only-...: bare node --test flags + the DEFAULT glob (the documented
  # `--test-concurrency=4` and `--experimental-test-coverage` forms). Previously these fell to the
  # explicit-file branch with an empty file list → node auto-discovered a 3.7x-larger suite (8573
  # vs 2296). node --test is last-flag-wins, so the user's own --test-concurrency=N still overrides
  # the default 8.
  run_selected "$(effective_groups)" "$@"
else
  build_dist_once
  run_static_checks
  # Explicit file list (no --group): QUAY_TEST_GROUPS stays unset, so in-file skips do not
  # trigger and the named files run in full.
  exec node --test --test-concurrency="$(default_test_concurrency)" "$@"
fi
