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
# AC3: the install source must contain scripts/quay-init.sh and loop/orchestrator-loop-tick.md —
#      missing any one FAILS naming the file. (inner-state.sh is retired and NOT in the shipping
#      set, gap-retire-inner-state-one-observer-targets-by-parameter AC3.)
# AC4 (negative control): --sabotage <relpath> deletes <relpath> from the install source so the
#      AC3 assertion fails naming it; re-run without --sabotage → exit 0.
# AC6: the target project gets NO npm install — the laid-down mechanism is self-contained.
# AC6b/AC4 (gap-quay-init-rewrites-an-executable-instead-of-generating-config): after install, EVERY
# installed executable under plugin/scripts/ is asserted byte-identical to its install source
# (verify-installed-executables.sh — 可执行文件一律原样复制，只生成配置). Config files (tick docs,
# orchestration/session-liveness.env) are explicit exceptions. --sabotage-byte flips ONE byte in the
# INSTALL SOURCE after install so the AC6 assertion must fail naming the file, then restores it so
# the assertion passes again — the bidirectional negative control that proves the check can fail.
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
# a one-shot `--once` real run (the script's cold-start seam). In an environment with no tmux
# session for the project's outer, --once honestly reports SESSION-STATUS <project> alive=0; what
# matters is that it RUNS, self-contained, after the rename.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_SRC="$REPO_ROOT/plugin"
FROM_BUILD=false
SABOTAGE=""
SABOTAGE_BYTE=""
E2E_BRANCH=""

usage() {
  cat <<'EOF'
Usage: bash test/cold-start-e2e.sh [--plugin-src <dir>] [--from-build] [--sabotage <relpath>] [--sabotage-byte <relpath>]
  --plugin-src <dir>   plugin source for the default (copy) path (default: $REPO_ROOT/plugin)
  --from-build         build via plugin/scripts/publish-dist-branch.sh (NO --push) and extract
                       the built plugin from the orphan commit via `git archive` (AC2/AC10)
  --sabotage <relpath> negative-control hook (AC4): delete <relpath> from the install source so
                       the AC3 completeness assertion fails naming it; restore by re-running
                       without --sabotage
  --sabotage-byte <relpath>  bidirectional negative control (AC4, gap-quay-init-rewrites-an-executable-...):
                       flip ONE byte in <relpath> of the INSTALL SOURCE after install, so the AC6
                       byte-identical assertion must FAIL naming it; then restore the byte so the
                       assertion PASSES again. Proves the AC6 check can fail (not always "same").
  --help, -h           show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --plugin-src) PLUGIN_SRC="$2"; shift 2 ;;
    --from-build) FROM_BUILD=true; shift ;;
    --sabotage) SABOTAGE="$2"; shift 2 ;;
    --sabotage-byte) SABOTAGE_BYTE="$2"; shift 2 ;;
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
for f in scripts/quay-init.sh loop/orchestrator-loop-tick.md; do
  assert_file "$QUAY_DEV/plugin/$f"
done
echo "  install source has quay-init.sh + orchestrator-loop-tick.md (inner-state.sh retired, not required)"

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
  resource-gate.sh task-contract-check.ts \
  task-status-drift-check.ts touches-orthogonality-check.ts concurrent-batch-scheduler.ts \
  it0-split-or-commit-check.ts pipe-exit-code-check.sh session-liveness.sh; do
  assert_file "$PROJECT/plugin/scripts/$s"
done
if [ -e "$PROJECT/plugin/scripts/heavy-op-token.sh" ]; then
  fail "heavy-op-token.sh must NOT be laid down into target projects (retired 2026-08-06, gap-session-liveness-remove-shared-events-and-lock)"
fi
if [ -e "$PROJECT/plugin/scripts/inner-state.sh" ]; then
  fail "inner-state.sh must NOT be laid down into target projects (retired, AC3)"
fi
# --all categories
assert_file "$PROJECT/.claude/workflows/drain-directives.js"
assert_file "$PROJECT/.claude/agents/quay-task.md"
# gap-gate-scripts-laid-down-but-dead-and-not-mutation-checked (2026-08-05): the retired
# plugin/gate-scripts/ category is NO LONGER laid down — the classic-pipeline era gates were dead
# weight in target projects. Negative control: scripts/gates/ must NOT exist after --all --loop.
if [ -e "$PROJECT/scripts/gates" ]; then fail "scripts/gates/ must NOT be laid down (retired gate scripts are dead weight)"; fi
echo "  all laid-down files present"

# ── AC6/AC4 (gap-quay-init-rewrites-an-executable-instead-of-generating-config): byte-identical ─────
# Principle: 可执行文件一律原样复制，只生成配置。After install, EVERY installed executable under
# plugin/scripts/ must be byte-identical to its install source. Config-class files are explicit
# exceptions: the tick docs (散文本地化, substitution is correct) and orchestration/session-liveness.env
# (quay-init 生成的每项目配置). This section is the EXECUTOR-visible mount point of the check — it
# also demonstrates the AC4 bidirectional negative control via --sabotage-byte.
echo "== AC6: installed executables byte-identical to source (verify-installed-executables.sh) =="
VERIFY_SCRIPT="$QUAY_DEV/plugin/scripts/verify-installed-executables.sh"
assert_file "$VERIFY_SCRIPT"

if [ -n "$SABOTAGE_BYTE" ]; then
  sb_target="$QUAY_DEV/plugin/$SABOTAGE_BYTE"
  assert_file "$sb_target"
  # fail direction: flip one byte in the INSTALL SOURCE after install → the AC6 check must fail.
  python3 - "$sb_target" <<'PY'
import sys
p = sys.argv[1]
b = bytearray(open(p, "rb").read())
b[0] ^= 0x01
open(p, "wb").write(bytes(b))
PY
  echo "  [AC4 sabotage-byte] flipped a byte in $SABOTAGE_BYTE (install source) — the AC6 check must now FAIL naming it"
  if bash "$VERIFY_SCRIPT" "$QUAY_DEV/plugin" "$PROJECT"; then
    fail "AC6 verify must FAIL after a one-byte drift in the source (AC4 fail direction)"
  fi
  echo "  AC6 correctly FAILED after the one-byte drift"
  # restore direction: flip it back → the AC6 check must pass again.
  python3 - "$sb_target" <<'PY'
import sys
p = sys.argv[1]
b = bytearray(open(p, "rb").read())
b[0] ^= 0x01
open(p, "wb").write(bytes(b))
PY
  echo "  [AC4 sabotage-byte] restored the byte — the AC6 check must now PASS again"
fi

bash "$VERIFY_SCRIPT" "$QUAY_DEV/plugin" "$PROJECT" || fail "AC6: an installed executable differs from its source (byte-identical invariant broken)"
echo "  AC6: every installed executable is byte-identical to its source"
# Negative control for the config exception: the session value must live in the generated env file,
# NOT baked into the installed script (AC1/AC2 — config, not code).
if grep -q '__QUAY_TMUX_SESSION__' "$PROJECT/plugin/scripts/session-liveness.sh"; then
  fail "installed session-liveness.sh still carries the install placeholder (AC1)"
fi
if ! grep -q '^SESSION_TMUX_SESSION=' "$PROJECT/orchestration/session-liveness.env"; then
  fail "orchestration/session-liveness.env lacks the generated SESSION_TMUX_SESSION (AC1/AC2)"
fi
echo "  session value is config (env file), not code (no placeholder in the installed script)"

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

# 7b. (removed) heavy-op token — retired entirely 2026-08-06 (human ruling:
#     gap-session-liveness-remove-shared-events-and-lock; the "one heavy test at a time"
#     constraint is gone with no replacement, so there is nothing to --status).

# 7c. (removed) inner-state.sh one-shot BLOCKED seam — inner-state.sh is retired
#     (gap-retire-inner-state-one-observer-targets-by-parameter AC4); the blocked channel is
#     written/read via inner-blocked-signal.ts directly, not via a retired monitor.

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

# 7g. (removed) inner-state.sh ≥90s window retest — inner-state.sh is retired
#     (gap-retire-inner-state-one-observer-targets-by-parameter AC4). The ONE observer is
#     session-liveness.sh, whose one-shot cold-start seam is asserted in 7f above; no
#     55-60s-polling monitor remains to need a ≥90s window.

# ── 8. wall-clock report (AC9 evidence) ─────────────────────────────────────────────────────────────
END_TS="$(date +%s)"
echo ""
echo "COLD-START E2E PASS: laid-down mechanism present, no quay dev-tree absolute path, and it still runs after the quay dev tree is renamed."
echo "wall-clock: $((END_TS - START_TS))s (from-build=$FROM_BUILD)"
exit 0
