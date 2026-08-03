#!/usr/bin/env bash
# test/cold-start-e2e.sh — AC8 (gap-loop-mechanism-lives-outside-the-package-and-cannot-ship).
#
# End-to-end cold start: a NEVER-used project (an empty temp dir) gets the quay two-layer loop
# mechanism from the PLUGIN (via quay-init --all --loop), and the laid-down mechanism must not
# depend on the quay dev tree at all.
#
# The rename negative control (AC8): after the laid-down mechanism is in place, the "quay dev
# tree" (the plugin source the mechanism was installed from) is RENAMED AWAY — and the laid-down
# mechanism must still run, exit 0. That proves the invariant "目标项目运行时不读取任何 quay
# 开发树下的绝对路径".
#
# SAFETY (协调方 2026-08-03 注意): this script never renames the REAL quay dev tree
# (/home/yale/work/quay or the worktree). It copies the plugin to a temp location, treats THAT as
# the source of truth for the install, lays down into a temp empty project, then renames the temp
# source. The real dev tree is untouched — the script never breaks its own working directory.
#
# Run: bash test/cold-start-e2e.sh
#   exit 0 = PASS (printed), non-zero = FAIL.
#
# ── gap-cold-start-e2e-installs-from-a-copy-and-nothing-runs-it (this task) ─────────────────────────
# The install source is selectable:
#   default:      a temp copy of the working-tree plugin (--plugin-src <dir>, default
#                 $REPO_ROOT/plugin). KEPT on purpose — it proves the "rename still works"
#                 invariant cheaply. It is NOT deliverability evidence (see below).
#   --from-build: the BUILT plugin, extracted from the orphan commit publish-dist-branch.sh
#                 produces, via `git archive` — NEVER a cp of the working tree (AC2). The build
#                 runs WITHOUT --push (AC10). This is the deliverability path: it installs the
#                 BUILD ARTIFACT, not a renamed source dir.
#
# AC3: the install source must contain scripts/quay-init.sh, scripts/inner-state.sh and
#      loop/orchestrator-loop-tick.md — missing any one FAILS naming the file.
# AC4 (negative control): --sabotage <relpath> deletes <relpath> from the install source so the
#      AC3 assertion fails naming it; re-run without --sabotage → exit 0.
# AC6: the target project gets NO npm install — the laid-down mechanism is self-contained.
# AC7: inner-state.sh gets a ≥90s window (it polls on a 55-60s cadence) with a real in-flight
#      task to observe, and must emit its INIT baseline — the outer's earlier 4s/0-byte
#      observation was INCONCLUSIVE (a 4s window proves neither alive nor dead).
# AC8: the temp branch (and the throwaway worktree publish-dist-branch.sh creates) are cleaned
#      on exit — no branch residue across repeated runs.
# AC9: the script prints its own wall-clock elapsed time; the executor decision (a cold-start-e2e
#      job in .github/workflows/ci.yml) is recorded in the task body.
#
# EXECUTOR: gap-cold-start-e2e-installs-from-a-copy-and-nothing-runs-it lands a real executor
#   (a cold-start-e2e job in .github/workflows/ci.yml, workflow_dispatch-gated so it is
#   milestone-cadence, not per-push). The assertions below are IN EFFECT from that task onward.
#
# AC7 (SPEC-outer-liveness-productization.md): asserts session-liveness.sh is laid down AND usable —
# a one-shot `--once` real run (the script's cold-start seam), matching inner-state.sh's seam in 7c.
# In an environment with no tmux session for the project's outer, --once honestly reports
# SESSION-STATUS <project> alive=0; what matters is that it RUNS, self-contained, after the rename.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_SRC="$REPO_ROOT/plugin"
FROM_BUILD=false
SABOTAGE=""
E2E_BRANCH=""

usage() {
  cat <<'EOF'
Usage: bash test/cold-start-e2e.sh [--plugin-src <dir>] [--from-build] [--sabotage <relpath>]
  --plugin-src <dir>   plugin source for the default (copy) path (default: $REPO_ROOT/plugin)
  --from-build         build via plugin/scripts/publish-dist-branch.sh (NO --push) and extract
                       the built plugin from the orphan commit via `git archive` (AC2/AC10)
  --sabotage <relpath> negative-control hook (AC4): delete <relpath> from the install source so
                       the AC3 completeness assertion fails naming it; restore by re-running
                       without --sabotage
  --help, -h           show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --plugin-src) PLUGIN_SRC="$2"; shift 2 ;;
    --from-build) FROM_BUILD=true; shift ;;
    --sabotage) SABOTAGE="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

fail() { echo "FAIL: $1" >&2; exit 1; }
assert_file() { [ -f "$1" ] || fail "missing file: $1"; }

START_TS="$(date +%s)"

echo "== cold-start e2e =="
echo "from-build: $FROM_BUILD"
echo "plugin source: $PLUGIN_SRC"

BASE="$(mktemp -d)"
cleanup() {
  rm -rf "$BASE"
  # AC8: the temp orphan branch publish-dist-branch.sh created must not accumulate across runs.
  if [ -n "$E2E_BRANCH" ]; then
    git -C "$REPO_ROOT" branch -D "$E2E_BRANCH" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ── 1. the install source: the "quay dev tree" the mechanism is installed from ──────────────────────
# The temp copy/extract is the "quay dev tree"; renaming IT below is the AC8 rename control.
# Preparing it as a temp artifact means the rename can never affect the real repo/worktree.
QUAY_DEV="$BASE/quay-dev"
mkdir -p "$QUAY_DEV"

if [ "$FROM_BUILD" = true ]; then
  # --from-build: build the plugin (NO --push) and extract the built artifacts from the orphan
  # commit via `git archive`. This is the deliverability path — the install source is the BUILD
  # ARTIFACT, not a cp of the working tree (AC2).
  echo "== building plugin from source (publish-dist-branch.sh, NO --push) =="
  E2E_BRANCH="e2e-dist-$$-$RANDOM"
  bash "$REPO_ROOT/plugin/scripts/publish-dist-branch.sh" --branch "$E2E_BRANCH"
  ORPHAN_SHA="$(git -C "$REPO_ROOT" rev-parse "$E2E_BRANCH")"
  ORPHAN_SHORT="$(git -C "$REPO_ROOT" rev-parse --short "$E2E_BRANCH")"
  echo "  orphan commit: $ORPHAN_SHORT ($ORPHAN_SHA)"

  echo "== extracting build artifacts via git archive (NOT cp of the working tree) =="
  mkdir -p "$QUAY_DEV/plugin"
  git -C "$REPO_ROOT" archive "$ORPHAN_SHA" | tar -x -C "$QUAY_DEV/plugin"
  echo "  extracted -> $QUAY_DEV/plugin"
else
  # default: the "quay dev tree" is a temp copy of the working-tree plugin. This path is KEPT
  # (the task preserves it) — it verifies the "rename still works" invariant cheaply. It is NOT
  # deliverability evidence (that is what --from-build is for).
  cp -r "$PLUGIN_SRC" "$QUAY_DEV/plugin"
  echo "simulated quay dev tree (temp source): $QUAY_DEV"
fi

# ── AC4 sabotage hook (negative control): delete a file from the install source ─────────────────────
# Used ONLY to demonstrate the fail direction of AC3 — re-run without --sabotage to restore.
if [ -n "$SABOTAGE" ]; then
  rm -f "$QUAY_DEV/plugin/$SABOTAGE"
  echo "  [AC4 sabotage] deleted $SABOTAGE from the install source — the AC3 assertion below must now fail naming it"
fi

# ── AC3: the install source must be a complete plugin (fail-named) ──────────────────────────────────
# Runs AFTER the sabotage hook so a --sabotage run fails HERE naming the missing file, and a
# normal run proves the install source is complete before the install.
echo "== AC3: install source completeness =="
for f in scripts/quay-init.sh scripts/inner-state.sh loop/orchestrator-loop-tick.md; do
  assert_file "$QUAY_DEV/plugin/$f"
done
echo "  install source has quay-init.sh + inner-state.sh + orchestrator-loop-tick.md"

# ── 2. empty target project (never used before) ─────────────────────────────────────────────────────
PROJECT="$BASE/empty-project"
mkdir -p "$PROJECT"
echo "empty target project: $PROJECT"

# ── 3. install: quay-init --all --loop from the source, with the target's values ────────────────────
CLAUDE_PLUGIN_ROOT="$QUAY_DEV/plugin" bash "$QUAY_DEV/plugin/scripts/quay-init.sh" \
  --all --loop \
  --root "$PROJECT" \
  --project empty-project \
  --repo-root "$PROJECT" \
  --test-command 'node --test' \
  --tmux-session 'empty-project-0:0.0'
echo ""

# ── 4. assert the loop-required files are present ───────────────────────────────────────────────────
echo "== asserting laid-down mechanism files =="
assert_file "$PROJECT/orchestration/orchestrator-loop-tick.md"
assert_file "$PROJECT/docs/analysis/fast-mode-loop-tick.md"
for s in \
  fast-mode-telemetry.ts inner-blocked-signal.ts inner-forensics.mjs inner-idle-log.ts \
  inner-state.sh resource-gate.sh heavy-op-token.sh task-contract-check.ts \
  task-status-drift-check.ts touches-orthogonality-check.ts concurrent-batch-scheduler.ts \
  it0-split-or-commit-check.ts pipe-exit-code-check.sh session-liveness.sh; do
  assert_file "$PROJECT/plugin/scripts/$s"
done
# --all categories
assert_file "$PROJECT/.claude/workflows/drain-directives.js"
assert_file "$PROJECT/.claude/agents/baime-iteration-executor.md"
if ! ls "$PROJECT"/scripts/gates/*.sh >/dev/null 2>&1; then fail "no gate scripts laid down"; fi
echo "  all laid-down files present"

# ── AC6: the target project got NO npm install (self-containment) ───────────────────────────────────
# sync-vendor.sh claims the vendored dist/quay.js is "fully self-contained (no npm install
# needed)" — turn that claim into an assertion: the target project must be npm-free, and (below)
# the laid-down mechanism must still run after the rename without any npm install.
echo "== AC6: self-containment (no npm install in the target project) =="
if [ -d "$PROJECT/node_modules" ]; then fail "target project has node_modules — npm install ran"; fi
if [ -d "$PROJECT/plugin/node_modules" ]; then fail "laid-down plugin has node_modules — npm install ran"; fi
echo "  no node_modules anywhere in the target project — the laid-down mechanism is self-contained"

# ── 5. negative control: no quay dev-tree absolute path in the laid-down project ────────────────────
echo "== negative controls =="
REAL_QUAY_ROOT="$REPO_ROOT"
if grep -rIn "$REAL_QUAY_ROOT" "$PROJECT" 2>/dev/null | grep -v '^Binary'; then
  fail "laid-down project references the quay dev tree root: $REAL_QUAY_ROOT"
fi
if grep -rIn "$QUAY_DEV" "$PROJECT" 2>/dev/null | grep -v '^Binary'; then
  fail "laid-down project references its temp install source: $QUAY_DEV"
fi
if grep -rIn 'scripts/test.sh' "$PROJECT/orchestration" "$PROJECT/docs" 2>/dev/null; then
  fail "laid-down tick docs still contain the quay-specific literal scripts/test.sh (AC4 negative control)"
fi
if grep -rIn 'quay-0:0.0' "$PROJECT/orchestration" "$PROJECT/docs" 2>/dev/null; then
  fail "laid-down tick docs still contain the quay tmux session quay-0:0.0"
fi
echo "  no quay dev-tree absolute path / quay-specific literal in the laid-down project"

# ── 6. AC8 rename control: rename the source the mechanism was installed from ───────────────────────
echo "== AC8 rename control =="
echo "renaming the quay dev tree: $QUAY_DEV -> $QUAY_DEV.renamed"
mv "$QUAY_DEV" "$QUAY_DEV.renamed"
if [ -e "$QUAY_DEV" ]; then fail "rename did not take effect"; fi
echo "  quay dev tree renamed away; the real dev tree at $REAL_QUAY_ROOT is untouched"

# ── 7. the laid-down mechanism must still run, exit 0 ───────────────────────────────────────────────
echo "== running the laid-down mechanism after the rename =="

# 7a. resource gate (reads /proc/pressure/cpu — self-contained). GO or WAIT are both valid verdicts;
#     what matters is that it RUNS (produces output) with no missing-source error.
GATE_OUT="$(bash "$PROJECT/plugin/scripts/resource-gate.sh" 2>&1 || true)"
[ -n "$GATE_OUT" ] || fail "resource-gate.sh produced no output (did not run after the rename)"
echo "  resource-gate.sh runs after the rename"

# 7b. heavy-op token (state lives outside every repo; --status is read-only)
bash "$PROJECT/plugin/scripts/heavy-op-token.sh" --status > /dev/null
echo "  heavy-op-token.sh --status runs (exit 0)"

# 7c. inner-state.sh one-shot seam (a present inner-blocked.json must emit BLOCKED)
BLOCK_ROOT="$BASE/block-root"
mkdir -p "$BLOCK_ROOT/.quay"
printf '{"since":0,"taskId":"e2e","reason":"task-over-90m","question":"abort it?"}\n' \
  > "$BLOCK_ROOT/.quay/inner-blocked.json"
if ! INNER_STATE_BLOCK_ROOT="$BLOCK_ROOT" bash "$PROJECT/plugin/scripts/inner-state.sh" \
     | grep -q 'BLOCKED reason=task-over-90m'; then
  fail "inner-state.sh one-shot did not emit BLOCKED after the rename"
fi
echo "  inner-state.sh one-shot emits BLOCKED (exit 0)"

# 7d. pipe-exit-code-check self-check (self-contained)
bash "$PROJECT/plugin/scripts/pipe-exit-code-check.sh" --self-check > /dev/null
echo "  pipe-exit-code-check.sh --self-check runs (exit 0)"

# 7e. telemetry checker resolves and reports (read-only --report against a workspace without data).
#     The empty project may have no telemetry store; the point is that the laid-down checker
#     RESOLVES and runs under node (no missing-module / missing-source error).
TEL_OUT="$(node --experimental-strip-types "$PROJECT/plugin/scripts/fast-mode-telemetry.ts" --report --json 2>&1 || true)"
if printf '%s' "$TEL_OUT" | grep -qi 'Cannot find\|MODULE_NOT_FOUND\|No such file'; then
  fail "fast-mode-telemetry.ts failed to resolve after the rename: $TEL_OUT"
fi
echo "  fast-mode-telemetry.ts resolves and runs after the rename"

# 7f. session-liveness.sh --once one-shot seam (AC7). It must RUN self-contained after the rename
#     and emit an SESSION-STATUS line for THIS project (basename of the project root). No tmux
#     session exists for the project in this environment, so alive=0 is the honest reading; the
#     point is that it lays down, self-locates, computes its default target and reports — no
#     quay-dev-tree dependency.
OL_OUT="$(bash "$PROJECT/plugin/scripts/session-liveness.sh" --once 2>&1 || true)"
if ! printf '%s' "$OL_OUT" | grep -q 'SESSION-STATUS empty-project alive='; then
  fail "session-liveness.sh --once did not emit SESSION-STATUS for this project after the rename: $OL_OUT"
fi
echo "  session-liveness.sh --once emits SESSION-STATUS empty-project alive=... (exit 0)"

# 7g. AC7: inner-state.sh ≥90s window retest (gap-cold-start-...-nothing-runs-it).
#     The outer's earlier observation was inner-state.sh producing 0 bytes in 4 seconds — that is
#     INCONCLUSIVE: it polls on a 55s/60s cadence, so a 4s window proves neither alive nor dead.
#     Retest with a ≥90s window AND a real state transition to observe (an in-flight task written
#     by the laid-down fast-mode-telemetry.ts), then run the ACTUAL long-running monitor for the
#     full window and require it to (a) emit its INIT baseline and (b) survive the whole window.
echo "== AC7: inner-state.sh >=90s window retest (polling cadence is 55-60s) =="
node --experimental-strip-types "$PROJECT/plugin/scripts/fast-mode-telemetry.ts" \
  --task-start --taskId e2e-ac7 --root "$PROJECT" >/dev/null
AC7_OUT_FILE="$BASE/ac7-inner-state.out"
set +e
timeout 95 bash "$PROJECT/plugin/scripts/inner-state.sh" >"$AC7_OUT_FILE" 2>&1
AC7_RC=$?
set -e
AC7_OUT="$(cat "$AC7_OUT_FILE")"
if ! printf '%s' "$AC7_OUT" | grep -q 'INIT 挂载时的在飞任务: e2e-ac7'; then
  fail "inner-state.sh did not emit its INIT baseline within a 95s window: $AC7_OUT"
fi
if [ "$AC7_RC" -ne 124 ]; then
  fail "inner-state.sh exited before the 95s window elapsed (rc=$AC7_RC) — the monitor must be long-running: $AC7_OUT"
fi
echo "  inner-state.sh emitted within the 95s window:"
printf '%s\n' "$AC7_OUT" | sed 's/^/    /'
echo "  inner-state.sh 60s-polling path is ALIVE and survives a >=90s window after the rename"

# ── 8. wall-clock report (AC9 evidence) ─────────────────────────────────────────────────────────────
END_TS="$(date +%s)"
echo ""
echo "COLD-START E2E PASS: laid-down mechanism present, no quay dev-tree absolute path, and it still runs after the quay dev tree is renamed."
echo "wall-clock: $((END_TS - START_TS))s (from-build=$FROM_BUILD)"
exit 0
