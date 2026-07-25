#!/usr/bin/env bash
# restart-readiness-check.sh — the mechanical go/no-go for un-halting exp5 (removing the .halt
# sentinel to hand development back to the autonomous OUTER loop). Turns "is master safe to hand to
# the loop?" from a judgment call into a runnable check (ADR-004 / Π_{S→E}). Operational script (not
# load-bearing method-infra imported by other code), so it is a .sh, not a covered *.mjs.
#
# Exit 0 = READY (all hard checks pass). Exit 1 = NOT READY (a hard check failed; do NOT un-halt).
# The pending-directive count is INFORMATIONAL (the loop DRAINs pending directives — a non-zero count
# is not a blocker, but is reported so you know what the loop's first act will process).
#
# Usage:  experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"   # scripts/ -> quay-perpetual-stream/ -> experiments/ -> repo root
cd "$ROOT" || { echo "ERROR: cannot cd to repo root ($ROOT)" >&2; exit 1; }
HALT="experiments/quay-perpetual-stream/.halt"
fail=0
ok()   { echo "  [ok]   $1"; }
bad()  { echo "  [FAIL] $1"; fail=1; }

echo "restart-readiness-check — repo: $ROOT"

# 1. Working tree clean (ignoring the .halt sentinel itself, which is expected to be present).
dirty="$(git status --short 2>/dev/null | grep -vE "(^\?\? )?experiments/quay-perpetual-stream/\.halt$")"
[ -z "$dirty" ] && ok "working tree clean (ignoring .halt)" || { bad "working tree NOT clean:"; echo "$dirty" | sed 's/^/         /'; }

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

# INFORMATIONAL: pending directives the loop's first DRAIN will process (not a hard blocker).
pend="$(node packages/quay/bin/quay.ts task list --label directive --json 2>/dev/null \
  | safe_json_parse_from_stdin 2>/dev/null \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{if(!s.trim()){console.log('?');return;}const p=JSON.parse(s).filter(x=>x.extra&&x.extra.dirStatus==='pending');console.log(p.length+' '+p.map(x=>x.id).join(','))})" 2>/dev/null)"
echo "  [info] pending directives (loop DRAINs these): ${pend:-unknown}"

echo ""
if [ "$fail" = 0 ]; then
  echo "READY ✓ — mechanical preconditions met. (Un-halt is still a human decision; recommend SUPERVISED restart.)"
  exit 0
else
  echo "NOT READY ✗ — at least one hard check failed; do NOT remove .halt until resolved."
  exit 1
fi
