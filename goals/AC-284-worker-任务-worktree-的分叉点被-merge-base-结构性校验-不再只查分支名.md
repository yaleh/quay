---
id: AC-284
title: worker 任务 worktree 的分叉点被 merge-base 结构性校验，不再只查分支名
status: active
kind: criterion
goal: GOAL-023
criterion: >-
  bash <<'CRIT'

  set -euo pipefail

  SCRIPT="plugin/scripts/dispatch-worktree-setup.sh"

  if [ ! -f "$SCRIPT" ]; then
    echo "CAUSE=script-absent — $SCRIPT does not exist" >&2; exit 1
  fi

  if ! grep -qE 'merge-base.*develop|merge-base.*--is-ancestor' "$SCRIPT"; then
    echo "CAUSE=forkpoint-check-absent — $SCRIPT has no merge-base/is-ancestor check against develop; it only validates the branch NAME pattern (task/*), not where the branch actually forked from — a worktree could still be silently based on a stale/wrong commit while passing this guard" >&2; exit 1
  fi

  echo "OK — $SCRIPT contains a merge-base-based fork-point check against
  develop"

  exit 0

  CRIT
expect: criterion exits 0 once dispatch-worktree-setup.sh contains a
  merge-base/is-ancestor check against develop
origin: dispatch-worktree-setup.sh 现在只检查分支名是不是 task/*，不检查分叉点，2026-09-08 已有一次相关事故先例
activatedAt: 2026-09-17T04:07:48.616Z
statusLog:
  - at: 2026-09-17T04:07:48.616Z
    from: draft
    to: active
    actor: manager
    reason: GOAL-023 激活，同步激活
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-17T04:07:48.616Z
---
