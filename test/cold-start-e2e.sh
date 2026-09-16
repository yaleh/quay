#!/usr/bin/env bash
# test/cold-start-e2e.sh — the cold-start DELIVERABILITY e2e (SPEC §6 QUAY-INIT-CLOSED-SET).
#
# ── RETARGETED 2026-09-16 (gap-cold-start-e2e-missing-orchestrator-loop-tick-md) ────────────────────
# This script USED to assert the retired copy machine: after `quay-init --all --loop`, the target
# project had to carry `orchestration/orchestrator-loop-tick.md`, `docs/analysis/fast-mode-loop-tick.md`,
# `plugin/scripts/*`, `.claude/workflows/*` and `.claude/agents/*` — and the so-installed mechanism had
# to keep running after the source it was installed from was renamed away.
#
# That premise was RETIRED by SPEC-plugin-lifecycle-single-bundle-2026-09-02 §6 (裁定 6) and landed in
# 6358b2cd6 ("AC168 收缩本体", 2026-09-08): `quay-init` is a PROJECT INITIALIZER, not an installer. Its
# write closure is the SEVEN-item closed set, and §6 names the retired surface verbatim:
#
#   "⛔ 不再写入：`.claude/workflows/`、`.claude/agents/`、`plugin/scripts/` 副本、`orchestration/`
#    tick 文档、`docs/analysis/`——以及随之退役的 managed/conflict/stale 整套机器。"
#
# ⇒ the old assertions were STRUCTURALLY UNSATISFIABLE: `$PROJECT/orchestration/orchestrator-loop-tick.md`
# can never exist after the shrink, so this job could never pass. It went unnoticed because the job is
# `workflow_dispatch`-gated (`if: github.event_name == 'workflow_dispatch'`) and had never really run.
# The fix is to assert the NEW contract, which is what this file now does:
#
#   LEG 1 — INSTALL SOURCE complete. The BUILT plugin must carry `scripts/quay-init.sh`, the loop tick
#           docs and the vendored native runtime. The plugin is the delivery vehicle (裁定 1): the
#           mechanism lives IN THE PLUGIN, not in a copy inside the project.
#   LEG 2 — CLOSED SET written, retired surface absent. After `quay-init --all --loop` the target holds
#           exactly the seven items (derived from the install source's own `CLOSED_SET_ITEMS`, never
#           from a second hand-written list) and NOTHING else; the retired copy surface is a
#           fail-named negative control (裁定 6: 不复制任何 Claude Code 扩展或脚本).
#   LEG 3 — EXPLICIT INSTALL STEP printed, and the delivered runtime actually RUNS. §6-T3 measured that
#           `enabledPlugins` only ENABLES an already-installed plugin (it never installs one) and that
#           an untrusted directory's project settings are not read at all — so "配置提交进仓库 ⇒ 自动装上"
#           is FALSE, and the init output must name the real steps instead of implying 配置即生效.
#           Then the vendored runtime the project's `.quay/config.yml` binds to must perform a REAL
#           operation against the project (存在≠生效 — DIR-026 Reading A).
#
# The SAFETY property is unchanged: this script NEVER renames the real quay dev tree. It copies the
# plugin to a temp location and treats THAT as the install source; the real dev tree is untouched.
#
# Run: bash test/cold-start-e2e.sh
#   exit 0 = PASS (printed), non-zero = FAIL.
#
# ── install source is selectable (gap-cold-start-e2e-installs-from-a-copy-and-nothing-runs-it) ──────
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
# AC8: the temp branch (and the throwaway worktree publish-dist-branch.sh creates) are cleaned
#      on exit — no branch residue across repeated runs.
# AC9: the script prints its own wall-clock elapsed time; the executor decision (a cold-start-e2e
#      job in .github/workflows/ci.yml) is recorded in the task body.
#
# EXECUTOR (gap-cold-start-e2e-installs-from-a-copy-and-nothing-runs-it): a real executor — the
#   `cold-start-e2e` job in .github/workflows/ci.yml, workflow_dispatch-gated so it is
#   milestone-cadence, not per-push. The assertions below are IN EFFECT from that task onward.
#
# ── hard rule 5b sweep (2026-09-16): the SAME dead premise survives elsewhere ────────────────────────
# Fixing this file does not fix the class. A same-carrier grep (`test/`) for the retired-laydown
# assertion found 4 more hits, all in ONE sibling file, plus one outside the carrier:
#   test/cold-start-oneliner-e2e.sh:142      required-file list names orchestration/orchestrator-loop-tick.md
#   test/cold-start-oneliner-e2e.sh:247      assert_file "$PROJECT/orchestration/orchestrator-loop-tick.md"
#   test/cold-start-oneliner-e2e.sh:248      assert_file "$PROJECT/docs/analysis/fast-mode-loop-tick.md"
#   test/cold-start-oneliner-e2e.sh:147/:162/:256  runs $PROJECT/plugin/scripts/* (the retired copy)
#   plugin/skills/cold-start/SKILL.md:36     precondition "tick docs laid down → <root>/orchestration/…"
# Neither is repaired here: both are outside this task's `## Touches`, and cold-start-oneliner-e2e.sh is
# DORMANT (wired into neither scripts/test.sh nor any CI job), so neither can red a gate on its own.
# They are the follow-up for whoever next touches the cold-start path — recorded, not hidden under
# this fix (a "fixed the one that was reported" fix is the failure mode this note exists to prevent).

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

Asserts the SPEC §6 closed-set contract (see the header comment). Exit 0 = PASS.
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
assert_dir() { [ -d "$1" ] || fail "missing directory: $1"; }
# The retired-surface control (SPEC §6 裁定 6). Fail-NAMED, never a bare "something was there".
assert_absent() { [ ! -e "$1" ] || fail "quay-init wrote the RETIRED surface: $1 (SPEC §6/裁定 6: 不复制任何 Claude Code 扩展或脚本 — 项目初始化器, 不是安装器; the plugin delivers the mechanism, the project does not carry a copy)"; }

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

# ── 1. the install source: the plugin the mechanism is delivered by ─────────────────────────────────
# The temp copy/extract is the "install source"; preparing it as a temp artifact means nothing here can
# affect the real repo/worktree.
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
  # default: the install source is a temp copy of the working-tree plugin. This path is KEPT
  # (the task preserves it) — it is the cheap path. It is NOT deliverability evidence (that is
  # what --from-build is for).
  cp -r "$PLUGIN_SRC" "$QUAY_DEV/plugin"
  echo "simulated install source (temp copy of the working-tree plugin): $QUAY_DEV"
fi

# ── AC4 sabotage hook (negative control): delete a file from the install source ─────────────────────
# Used ONLY to demonstrate the fail direction of AC3 — re-run without --sabotage to restore.
if [ -n "$SABOTAGE" ]; then
  rm -f "$QUAY_DEV/plugin/$SABOTAGE"
  echo "  [AC4 sabotage] deleted $SABOTAGE from the install source — the AC3 assertion below must now fail naming it"
fi

# ── AC3 + LEG 1: the install source must be a complete plugin (fail-named) ──────────────────────────
# Runs AFTER the sabotage hook so a --sabotage run fails HERE naming the missing file, and a
# normal run proves the install source is complete before the install.
echo "== AC3 / LEG 1: install source completeness (the mechanism lives in the PLUGIN) =="
for f in scripts/quay-init.sh loop/orchestrator-loop-tick.md; do
  assert_file "$QUAY_DEV/plugin/$f"
done
echo "  install source has quay-init.sh + orchestrator-loop-tick.md (inner-state.sh is retired, not required)"
# The install source must carry the whole loop surface the cold start needs: BOTH tick docs the
# two layers read, and the vendored provider runtime the generated config will bind to (LEG 3).
for f in loop/fast-mode-loop-tick.md vendor/quay-native/dist/quay-native.js vendor/quay/dist/quay.js; do
  assert_file "$QUAY_DEV/plugin/$f"
done
echo "  install source carries both tick docs + the vendored quay/quay-native runtimes"

# ── 2. empty target project (never used before) ─────────────────────────────────────────────────────
PROJECT="$BASE/empty-project"
mkdir -p "$PROJECT"
echo "empty target project: $PROJECT"

# ── 3. install: quay-init --all --loop from the source, with the target's values ────────────────────
INIT_OUT="$(CLAUDE_PLUGIN_ROOT="$QUAY_DEV/plugin" bash "$QUAY_DEV/plugin/scripts/quay-init.sh" \
  --all --loop \
  --root "$PROJECT" \
  --project empty-project \
  --repo-root "$PROJECT" \
  --test-command 'node --test' \
  --tmux-session 'empty-project-0:0.0' 2>&1)" || { printf '%s\n' "$INIT_OUT"; fail "quay-init --all --loop exited non-zero"; }
printf '%s\n' "$INIT_OUT"
echo ""

# ── 4. LEG 2a: the closed set is written ────────────────────────────────────────────────────────────
# The expected set is READ FROM THE INSTALL SOURCE (the mechanism's own CLOSED_SET_ITEMS in
# quay-init.sh), never a second hand-written list in this file — a copy here would be exactly the
# "content living in two places" drift this repo forbids.
echo "== LEG 2a: the closed set is written (expected set read from the install source) =="
CLOSED_SET_RAW="$(sed -n 's/^CLOSED_SET_ITEMS="\(.*\)"$/\1/p' "$QUAY_DEV/plugin/scripts/quay-init.sh")"
if [ -z "$CLOSED_SET_RAW" ]; then
  # hard rule 3b: a checker that could NOT read its input must never look like 合格.
  fail "could not read CLOSED_SET_ITEMS from the install source's quay-init.sh — the closed-set assertion has NO input (NOT-EVALUATED, not a pass)"
fi
for item in $CLOSED_SET_RAW; do
  case "${item##*/}" in
    # a member with no dot in its last segment is a DIRECTORY member (tasks/ or goals/)
    *.*) assert_file "$PROJECT/$item" ;;
    *) assert_dir "$PROJECT/$item" ;;
  esac
done
echo "  all $(printf '%s\n' $CLOSED_SET_RAW | wc -l) closed-set members present: $CLOSED_SET_RAW"

# ── 4b. LEG 2b: NOTHING outside the closed set was written, and the retired surface is absent ───────
# The strong form: enumerate what is actually on disk and require every path to be a closed-set
# member (or a descendant of a directory member). This is the same membership judgment
# plugin/scripts/quay-init-closure-assertion.ts performs (its FORBIDDEN_PREFIXES list is the 正本 for
# the retired surface) — asserted here against the REAL target of THIS install, which that checker
# cannot do because it runs its own laydown.
echo "== LEG 2b: no path outside the closed set (ratchet) =="
is_closed_member() {
  local rel="$1" item
  for item in $CLOSED_SET_RAW; do
    [ "$rel" = "$item" ] && return 0
    case "${item##*/}" in
      # directory member ⇒ its descendants are members too
      *.*) ;;
      *) case "$rel" in "$item"/*) return 0 ;; esac ;;
    esac
  done
  return 1
}
UNEXPECTED=""
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  is_closed_member "$rel" && continue
  UNEXPECTED="$UNEXPECTED $rel"
done < <(cd "$PROJECT" && find . -type f -not -path './.git/*' | sed 's|^\./||')
[ -z "$UNEXPECTED" ] || fail "quay-init wrote path(s) OUTSIDE the SPEC §6 closed set:$UNEXPECTED (the write surface must not grow silently — see plugin/scripts/quay-init-closure-assertion.ts)"
echo "  every written path is a closed-set member — the write surface did not grow"

echo "== LEG 2c: the RETIRED copy surface is absent (裁定 6 negative control) =="
for d in plugin orchestration docs/analysis .claude/workflows .claude/agents \
         .claude/skills .claude/commands .claude/hooks node_modules; do
  assert_absent "$PROJECT/$d"
done
assert_absent "$PROJECT/.mcp.json"
echo "  no plugin/ orchestration/ docs/analysis/ extension copies, no node_modules — the project is config-only"

# ── 5. LEG 3a: the explicit install step is printed (§6-T3) ─────────────────────────────────────────
# §6-T3 measured that `enabledPlugins` ENABLES an already-installed plugin and never installs one, and
# that an untrusted directory's project settings are not read at all. So the init output MUST name the
# real steps; "配置即生效" would be the repo's most expensive failure class (存在≠生效).
echo "== LEG 3a: the output names the explicit plugin install step (§6-T3) =="
printf '%s\n' "$INIT_OUT" | grep -q 'claude plugin marketplace add' \
  || fail "quay-init output does not name 'claude plugin marketplace add' — the install step must be explicit, not implied by config (§6-T3)"
printf '%s\n' "$INIT_OUT" | grep -q 'claude plugin install' \
  || fail "quay-init output does not name 'claude plugin install' — enabledPlugins only ENABLES an installed plugin (§6-T3)"
echo "  the output names the marketplace-add + plugin-install steps explicitly"

# ── 6. LEG 3b: the delivered runtime actually OPERATES the project (存在≠生效) ──────────────────────
# The project carries NO copy of the runtime — it binds to the plugin's vendored bundle via
# .quay/config.yml. Prove the binding is LIVE (not dangling) and that the delivered runtime performs a
# REAL operation against this project: create a task through it, then read it back.
echo "== LEG 3b: the delivered vendored runtime operates the project =="
CFG="$PROJECT/.quay/config.yml"
assert_file "$CFG"
MCP_TARGET="$(sed -n 's/.*"\([^"]*quay-native\.js\)".*/\1/p' "$CFG" | head -1)"
[ -n "$MCP_TARGET" ] || fail "could not read the native provider runtime path out of $CFG (NOT-EVALUATED, not a pass)"
assert_file "$MCP_TARGET"
echo "  project binds to the plugin-delivered runtime: $MCP_TARGET"

PROBE_ID="cold-start-e2e-probe"
QUAY_NATIVE_TASKS_DIR="$PROJECT/tasks" QUAY_NATIVE_GOAL_DIR="$PROJECT/goals" \
  node "$MCP_TARGET" task create "$PROBE_ID" --title "cold-start e2e probe" >/dev/null \
  || fail "the delivered runtime could not create a task in the project (存在≠生效: the binding resolved but does not operate)"
assert_file "$PROJECT/tasks/$PROBE_ID.md"
LIST_OUT="$(QUAY_NATIVE_TASKS_DIR="$PROJECT/tasks" QUAY_NATIVE_GOAL_DIR="$PROJECT/goals" node "$MCP_TARGET" task list)"
printf '%s\n' "$LIST_OUT" | grep -q "$PROBE_ID" \
  || fail "the delivered runtime created a task but did not list it back: $LIST_OUT"
echo "  the delivered runtime created AND listed $PROBE_ID through the project's own task store"

# ── 7. negative control: the project does not bind to the quay WORKING TREE ─────────────────────────
# The honest successor of the retired "rename the source and it still runs" control. Under §6 the
# project DOES bind to the plugin it was initialized from (that is the delivery contract) — but it must
# never bind to the quay repo's own working tree, which is a dev-tree artifact, not a delivery channel.
echo "== negative controls =="
REAL_QUAY_ROOT="$REPO_ROOT"
if grep -rIn "$REAL_QUAY_ROOT" "$PROJECT" 2>/dev/null | grep -v '^Binary'; then
  fail "the initialized project references the quay WORKING TREE root: $REAL_QUAY_ROOT"
fi
# The project's loop values must be the ones THIS install was given, never quay's own dev-tree values
# baked in as defaults. (Asserted as an exact field read rather than a bare literal grep: the generated
# config legitimately MENTIONS `scripts/test.sh` in a caution comment about the loop.test_command
# contract, so a substring grep would false-positive on correct output.)
grep -qx '  test_command: node --test' "$CFG" \
  || fail "the initialized project's loop.test_command is not the value passed to this install (quay's own dev-tree entrypoint leaked in?)"
grep -qx '  tmux_session: empty-project-0:0.0' "$CFG" \
  || fail "the initialized project's loop.tmux_session is not the value passed to this install (quay's own session leaked in?)"
echo "  the project's own loop values are the ones this install was given"

# ── 8. LEG 2d: quay-init is IDEMPOTENT on the project it just created ───────────────────────────────
# A re-run must exit 0 and leave the closed set intact (the config carries an incremental-upgrade
# branch; a second run must not append, duplicate or drop anything).
echo "== LEG 2d: re-running quay-init is idempotent =="
BEFORE_FILES="$(cd "$PROJECT" && find . -type f -not -path './.git/*' | sort)"
CLAUDE_PLUGIN_ROOT="$QUAY_DEV/plugin" bash "$QUAY_DEV/plugin/scripts/quay-init.sh" \
  --all --loop \
  --root "$PROJECT" \
  --project empty-project \
  --repo-root "$PROJECT" \
  --test-command 'node --test' \
  --tmux-session 'empty-project-0:0.0' >/dev/null 2>&1 \
  || fail "the second quay-init run exited non-zero (upgrade path is not idempotent)"
AFTER_FILES="$(cd "$PROJECT" && find . -type f -not -path './.git/*' | sort)"
[ "$BEFORE_FILES" = "$AFTER_FILES" ] \
  || fail "the second quay-init run changed the file set:$(printf '\n  before:%s\n  after:%s' "$(printf '%s' "$BEFORE_FILES" | tr '\n' ' ')" "$(printf '%s' "$AFTER_FILES" | tr '\n' ' ')")"
echo "  the second run exits 0 and leaves the file set unchanged"

# ── 9. wall-clock report (AC9 evidence) ─────────────────────────────────────────────────────────────
END_TS="$(date +%s)"
echo ""
echo "COLD-START E2E PASS: the built plugin delivers the mechanism, quay-init writes exactly the SPEC §6"
echo "closed set (and none of the retired copy surface), names the explicit install step, and the"
echo "plugin-delivered runtime actually operates the project."
echo "wall-clock: $((END_TS - START_TS))s (from-build=$FROM_BUILD)"
exit 0
