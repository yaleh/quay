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

  LINE="$(grep -nE
  'const[[:space:]]+mergeTarget[[:space:]]*=[[:space:]]*opts\.mergeTarget'
  "$SRC" | head -1)"

  if [ -z "$LINE" ]; then
    echo "CAUSE=default-assignment-not-found — no line in $SRC assigns 'const mergeTarget = opts.mergeTarget ?? ...' — the mechanical fan-in's default merge-target expression may have been refactored; this criterion needs updating, not silently passed" >&2; exit 1
  fi

  case "$LINE" in
    *'"develop"'*) echo "OK — $SRC's mergeTarget default assignment is: ${LINE#*:}"; exit 0 ;;
    *) echo "CAUSE=default-not-develop — $SRC's mergeTarget default assignment no longer defaults to \"develop\": ${LINE#*:}" >&2; exit 1 ;;
  esac

  CRIT
expect: criterion exits 0 as long as worker-driver.ts's mechanical fan-in path
  still references develop as the merge target
origin: 本方案不改变 fan-in 目标，需要一条判据防止未来意外漂移
---
