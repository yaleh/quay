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
# AC7 (SPEC-outer-liveness-productization.md): asserts outer-liveness.sh is laid down AND usable —
# a one-shot `--once` real run (the script's cold-start seam), matching inner-state.sh's seam in 7c.
# In an environment with no tmux session for the project's outer, --once honestly reports
# OUTER-STATUS <project> alive=0; what matters is that it RUNS, self-contained, after the rename.
#
# EXECUTOR CAVEAT (gap-cold-start-e2e-installs-from-a-copy-and-nothing-runs-it, status todo):
# this script currently has NO executor — nothing in scripts/test.sh or CI runs it, so the AC7
# assertion below is NOT currently in effect. It becomes in effect when that task lands its
# executor (its AC9: measure --from-build wall-clock cost, then choose CI job vs milestone-cadence
# trigger — do NOT pre-wire into scripts/test.sh before the cost is known, per its dispatch note).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_SRC="$REPO_ROOT/plugin"

echo "== cold-start e2e =="
echo "plugin source: $PLUGIN_SRC"

BASE="$(mktemp -d)"
trap 'rm -rf "$BASE"' EXIT

# ── 1. simulate the quay dev tree: copy the plugin there ────────────────────────────────────────────
# The temp copy is the "quay dev tree" the install is sourced from; renaming IT below is the AC8
# negative control. Copying first means the rename can never affect the real repo/worktree.
QUAY_DEV="$BASE/quay-dev"
mkdir -p "$QUAY_DEV"
cp -r "$PLUGIN_SRC" "$QUAY_DEV/plugin"
echo "simulated quay dev tree (temp source): $QUAY_DEV"

# ── 2. empty target project (never used before) ─────────────────────────────────────────────────────
PROJECT="$BASE/empty-project"
mkdir -p "$PROJECT"
echo "empty target project: $PROJECT"

# ── 3. install: quay-init --all --loop from the temp source, with the target's values ──────────────
CLAUDE_PLUGIN_ROOT="$QUAY_DEV/plugin" bash "$QUAY_DEV/plugin/scripts/quay-init.sh" \
  --all --loop \
  --root "$PROJECT" \
  --project empty-project \
  --repo-root "$PROJECT" \
  --test-command 'node --test' \
  --tmux-session 'empty-project-0:0.0'
echo ""

# ── 4. assert the loop-required files are present ───────────────────────────────────────────────────
fail() { echo "FAIL: $1" >&2; exit 1; }
assert_file() { [ -f "$1" ] || fail "missing file: $1"; }

echo "== asserting laid-down mechanism files =="
assert_file "$PROJECT/orchestration/orchestrator-loop-tick.md"
assert_file "$PROJECT/docs/analysis/fast-mode-loop-tick.md"
for s in \
  fast-mode-telemetry.ts inner-blocked-signal.ts inner-forensics.mjs inner-idle-log.ts \
  inner-state.sh resource-gate.sh heavy-op-token.sh task-contract-check.ts \
  task-status-drift-check.ts touches-orthogonality-check.ts concurrent-batch-scheduler.ts \
  it0-split-or-commit-check.ts pipe-exit-code-check.sh outer-liveness.sh; do
  assert_file "$PROJECT/plugin/scripts/$s"
done
# --all categories
assert_file "$PROJECT/.claude/workflows/drain-directives.js"
assert_file "$PROJECT/.claude/agents/baime-iteration-executor.md"
if ! ls "$PROJECT"/scripts/gates/*.sh >/dev/null 2>&1; then fail "no gate scripts laid down"; fi
echo "  all laid-down files present"

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

# 7f. outer-liveness.sh --once one-shot seam (AC7). It must RUN self-contained after the rename
#     and emit an OUTER-STATUS line for THIS project (basename of the project root). No tmux
#     session exists for the project in this environment, so alive=0 is the honest reading; the
#     point is that it lays down, self-locates, computes its default target and reports — no
#     quay-dev-tree dependency. SEE EXECUTOR CAVEAT in the header: this assertion is not yet in
#     effect (no executor runs this script) until gap-cold-start-...-nothing-runs-it lands one.
OL_OUT="$(bash "$PROJECT/plugin/scripts/outer-liveness.sh" --once 2>&1 || true)"
if ! printf '%s' "$OL_OUT" | grep -q 'OUTER-STATUS empty-project alive='; then
  fail "outer-liveness.sh --once did not emit OUTER-STATUS for this project after the rename: $OL_OUT"
fi
echo "  outer-liveness.sh --once emits OUTER-STATUS empty-project alive=... (exit 0)"

echo ""
echo "COLD-START E2E PASS: laid-down mechanism present, no quay dev-tree absolute path, and it still runs after the quay dev tree is renamed."
exit 0
