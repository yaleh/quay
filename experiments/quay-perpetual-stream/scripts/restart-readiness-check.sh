#!/usr/bin/env bash
# restart-readiness-check.sh — the mechanical go/no-go for resuming a halted driver (before running
# `quay driver resume` to hand development back to the autonomous driver loop). Turns "is the git
# tree safe to resume?" from a judgment call into a runnable check (ADR-004 / Π_{S→E}). Operational
# script (not load-bearing method-infra imported by other code), so it is a .sh, not a covered *.mjs.
# (gap-retire-halt-file-driver-based, 2026-08-29: the .halt sentinel's promotion/execution role is
# dead — the driver control-state (.quay/worker-control.json / promotion-control.json) replaced it —
# so this check's target is now `quay driver resume`, not "remove .halt".)
#
# MANUAL-ONLY, NOT CI/LOOP-WIRED (gap-orphaned-check-scripts-not-wired, M-DIR119-C-CANARY,
# 2026-07-27, explicit decision — named loudly here per that gap's own Requested action, not a
# silent omission): nothing invokes this automatically before a resume. A human (or an agent
# acting on human instruction) runs this BY HAND before running `quay driver resume`.
#
# Exit 0 = READY (all hard checks pass). Exit 1 = NOT READY (a hard check failed; do NOT resume).
# The pending-directive count is INFORMATIONAL (the loop DRAINs pending directives — a non-zero count
# is not a blocker, but is reported so you know what the loop's first act will process).
#
# Checks 1-5 are the exp5-era git/selfcheck gate. Check 6 (full `scripts/test.sh`) was added
# 2026-08-02 for fast mode: the exp5 selfchecks never run scripts/test.sh (verified: the four
# run_check entries only cover task-schema/dod-fixture/vmeta-lag/loadbearing), but fast mode runs
# directly on master and its loop tick stops on "full suite not green". A READY ✓ here is only
# meaningful if the suite actually passes — otherwise resuming hands the loop a guaranteed
# self-stop. Check 6 is deliberately slow (~560s on this repo): resume is a rare deliberate action.
#
# Usage:  experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
# QUAY_RR_ROOT overrides the repo root — a test seam for restart-readiness-check.test.mjs to run the
# inner-blocked check against a temp workspace without touching the real repo or paying the ~560s
# full suite. Production callers never set it → default (real repo root), behavior unchanged.
ROOT="${QUAY_RR_ROOT:-$(cd "$HERE/../../.." && pwd)}"   # scripts/ -> quay-perpetual-stream/ -> experiments/ -> repo root
cd "$ROOT" || { echo "ERROR: cannot cd to repo root ($ROOT)" >&2; exit 1; }
fail=0
ok()   { echo "  [ok]   $1"; }
bad()  { echo "  [FAIL] $1"; fail=1; }

echo "restart-readiness-check — repo: $ROOT"

# ── 7. Inner-layer block signal (gap-no-explicit-blocked-signal-from-inner-layer, AC5) ─────────────
# A present .quay/inner-blocked.json means the inner layer STOPPED and is waiting for a ruling — it
# has NOT recovered. The record is PRINTED so the human knows exactly what to rule on. This is a
# HARD FAIL, not informational: resuming while a block is asserted hands the loop a self-stopping
# state (the resumed tick re-hits the same stop-and-wait), and the task's own AC5 parenthetical says
# it plainly — "内层在等裁定 ≠ 可以 resume". The file is gitignored, so it does not disturb
# check 1's working-tree-clean assertion. Kept as a named function so the RR_ONLY_BLOCK_CHECK test
# seam can run JUST this check behaviorally.
check_inner_blocked() {
  if [ -f "$ROOT/.quay/inner-blocked.json" ]; then
    blockinfo="$(node --no-warnings --experimental-strip-types "$ROOT/plugin/scripts/inner-blocked-signal.ts" --read --root "$ROOT" 2>/dev/null)"
    if [ -n "$blockinfo" ]; then
      br="$(printf '%s' "$blockinfo" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log((j.reason||'?')+' — '+j.question)}catch(e){console.log('unparsable record')}})" 2>/dev/null)"
      bad "inner layer is BLOCKED (waiting for a ruling): $br"
    else
      bad "inner layer is BLOCKED (.quay/inner-blocked.json present but unreadable by inner-blocked-signal.ts --read)"
    fi
  else
    ok "no inner-layer block signal (.quay/inner-blocked.json absent)"
  fi
}

# ── 8. Stranded worktree branches (INFORMATIONAL — gap-stranded-worktree-branches-have-no-alarm-channel) ──
# A silent fail-closed preserves a branch's work (Land fails closed rather than discarding) but NOTHING
# reports it — 2026-08-01: 4 branches / 24,989 lines sat stranded for a day, found only because a human
# ran `git worktree list` by accident. The resume go/no-go checks the clean tree and mid-flight merge
# but MISSED exactly this class; it must SHOW stranded branches even though they are NOT a hard blocker
# (some are legitimately waiting to merge/adjudicate, e.g. the human-retained M239). Delegates to
# task-status-drift-check.ts --stranded (the named check; the three-gate criterion lives THERE, reused
# from gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion, not re-implemented here). NEVER sets
# fail — informational only.
check_stranded_branches() {
  stranded_out="$(node --no-warnings --experimental-strip-types "$ROOT/plugin/scripts/task-status-drift-check.ts" --stranded 2>/dev/null)"
  if [ -z "$stranded_out" ] || printf '%s' "$stranded_out" | grep -q "^ERROR"; then
    ok "stranded-branch check unavailable (task-status-drift-check.ts --stranded silent or errored)"
  elif printf '%s' "$stranded_out" | grep -q "no stranded worktree branches"; then
    ok "no stranded worktree branches (milestone/* and task/* cleanly merged)"
  else
    echo "  [info] STRANDED worktree branches — work is preserved on a branch NOT on master (NOT a hard blocker, but merge/adjudicate before assuming all work is on master):"
    printf '%s' "$stranded_out" | sed 's/^/         /'
  fi
}

# Test seam (restart-readiness-check.test.mjs): run ONLY check 7 against the (possibly overridden)
# ROOT, then print the same summary and exit. Skips checks 1-6 including the ~560s full suite.
# Production callers never set it → normal full run, behavior unchanged.
if [ "${RR_ONLY_BLOCK_CHECK:-0}" = "1" ]; then
  check_inner_blocked
  echo ""
  if [ "$fail" = 0 ]; then
    echo "READY ✓ — mechanical preconditions met. (Resume is still a human decision; recommend SUPERVISED restart.)"
    exit 0
  else
    echo "NOT READY ✗ — at least one hard check failed; do NOT run `quay driver resume` until resolved."
    exit 1
  fi
fi

# Test seam (restart-readiness-check.test.mjs): run ONLY check 8 (stranded branches) against the
# (possibly overridden) ROOT — a real temp git repo with a fabricated stranded branch. Skips checks
# 1-7 including the ~560s full suite. Production callers never set it → normal full run, unchanged.
if [ "${RR_ONLY_STRANDED_CHECK:-0}" = "1" ]; then
  check_stranded_branches
  echo ""
  if [ "$fail" = 0 ]; then
    echo "READY ✓ — mechanical preconditions met. (Resume is still a human decision; recommend SUPERVISED restart.)"
    exit 0
  else
    echo "NOT READY ✗ — at least one hard check failed; do NOT run `quay driver resume` until resolved."
    exit 1
  fi
fi

# 1. Working tree clean.
dirty="$(git status --short 2>/dev/null)"
[ -z "$dirty" ] && ok "working tree clean" || { bad "working tree NOT clean:"; echo "$dirty" | sed 's/^/         /'; }

# 2. No merge in progress.
[ ! -f .git/MERGE_HEAD ] && ok "no MERGE_HEAD (no merge in progress)" || bad ".git/MERGE_HEAD present — a merge is mid-flight"

# 3. No unmerged (conflicted) index entries.
u="$(git ls-files -u | wc -l | tr -d ' ')"
[ "$u" = "0" ] && ok "no unmerged index entries" || bad "$u unmerged index entries"

# 4. master is not checked out in a worktree OTHER than the main repo root (so a ref-update / merge
#    can never collide with a loop publish sub-step).
stray="$(git worktree list 2>/dev/null | grep -w master | grep -vF "$ROOT ")"
[ -z "$stray" ] && ok "master not checked out in a stray worktree" || { bad "master checked out in another worktree:"; echo "$stray" | sed 's/^/         /'; }

# 5. All experiment selfchecks + the load-bearing-test gate green (the loop's own hardened checks).
run_check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$name green"; else bad "$name FAILED (run it to see why)"; fi
}
SCR="experiments/quay-perpetual-stream/scripts"
source "$SCR/safe-json-parse.sh"
run_check "task-schema-selfcheck"  bash "$SCR/task-schema-selfcheck.sh"
run_check "dod-fixture-selfcheck"  bash "$SCR/dod-fixture-selfcheck.sh"
run_check "vmeta-lag-selfcheck"    bash "$SCR/vmeta-lag-selfcheck.sh"
run_check "loadbearing-test-gate"  bash "$SCR/loadbearing-test-gate.sh" \
  --scripts "$SCR" --tests experiments/quay-perpetual-stream/test --import-root "$SCR" \
  --registry packages/quay/src/gate/registry.js --outer-loop experiments/quay-perpetual-stream/OUTER-LOOP.md

# 6. Full test suite green (the fast-mode tick's hard stop condition, NOT covered by the exp5-era
#    selfchecks above — those only run task-schema/dod-fixture/vmeta-lag/loadbearing, never
#    scripts/test.sh). Fast mode runs DIRECTLY on master and its tick stops on "full suite not
#    green", so a READY here must mean the suite actually passes — otherwise resuming hands a
#    self-stopping loop to the next tick. This is the fast-mode "is master safe to hand to the
#    loop?" gate; it is deliberately the SLOW check (~560s on this repo) — resume is a rare,
#    deliberate action. Fast mode's default group is product,engine (governance self-skips).
if [ -f "$ROOT/scripts/test.sh" ]; then
  run_check "full-test-suite (scripts/test.sh)" bash "$ROOT/scripts/test.sh"
else
  # exp5 (no fast-mode): scripts/test.sh may not exist; the loop's own checks above are the gate.
  ok "full-test-suite skipped (no scripts/test.sh — exp5-only repo, selfchecks are the gate)"
fi

# 7. Inner-layer block signal — see the check_inner_blocked function defined above.
check_inner_blocked

# 8. Stranded worktree branches — informational (never a hard blocker), see check_stranded_branches.
check_stranded_branches

# INFORMATIONAL: pending directives the loop's first DRAIN will process (not a hard blocker).
pend="$(node packages/quay/bin/quay.ts task list --label directive --json 2>/dev/null \
  | safe_json_parse_from_stdin 2>/dev/null \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{if(!s.trim()){console.log('?');return;}const p=JSON.parse(s).filter(x=>x.extra&&x.extra.dirStatus==='pending');console.log(p.length+' '+p.map(x=>x.id).join(','))})" 2>/dev/null)"
echo "  [info] pending directives (loop DRAINs these): ${pend:-unknown}"

echo ""
if [ "$fail" = 0 ]; then
  echo "READY ✓ — mechanical preconditions met. (Resume is still a human decision; recommend SUPERVISED restart.)"
  exit 0
else
  echo "NOT READY ✗ — at least one hard check failed; do NOT run `quay driver resume` until resolved."
  exit 1
fi
