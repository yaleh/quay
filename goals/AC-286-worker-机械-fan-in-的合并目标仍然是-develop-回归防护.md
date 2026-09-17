---
id: AC-286
title: worker 机械 fan-in 的合并目标仍然是 develop（回归防护）
status: draft
kind: criterion
goal: GOAL-023
criterion: >-
  bash <<'CRIT'

  set -euo pipefail

  SRC="plugin/scripts/worker-driver.ts"

  if [ ! -f "$SRC" ]; then
    echo "CAUSE=source-absent — $SRC does not exist" >&2; exit 1
  fi

  if ! grep -qE
  '"merge".*"--no-edit".*develop|rev-parse.*develop|mergeTarget.*develop'
  "$SRC"; then
    echo "CAUSE=fan-in-target-not-develop-in-source — no line in $SRC ties the mechanical fan-in merge target to the literal 'develop' — the invariant that workers fan-in into develop may have drifted" >&2; exit 1
  fi

  echo "OK — $SRC's fan-in path references 'develop' as the merge target"

  exit 0

  CRIT
expect: criterion exits 0 as long as worker-driver.ts's mechanical fan-in path
  still references develop as the merge target
origin: 本方案不改变 fan-in 目标，需要一条判据防止未来意外漂移
---
