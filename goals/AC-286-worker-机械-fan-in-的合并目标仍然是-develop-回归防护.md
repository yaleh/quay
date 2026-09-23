---
id: AC-286
title: worker 机械 fan-in 的合并目标仍然是 develop（回归防护）
status: achieved
kind: criterion
goal: GOAL-023
criterion: >-
  bash <<'CRIT'

  set -euo pipefail


  # 结构解析（⛔ 不钉文件路径）：机械 fan-in 的实现模块 = 定义 runMechanicalFanIn 的那份

  FANIN="$(grep -rlE '^export async function runMechanicalFanIn'
  plugin/scripts/*.ts 2>/dev/null | head -1 || true)"


  if [ -z "$FANIN" ]; then
    echo "CAUSE=fanin-module-unresolved — no plugin/scripts/*.ts defines runMechanicalFanIn; the region was renamed/moved again — re-anchor this criterion, do not silently pass" >&2; exit 1
  fi


  LINE="$(grep -nE
  'const[[:space:]]+mergeTarget[[:space:]]*=[[:space:]]*opts\.mergeTarget'
  "$FANIN" | head -1 || true)"


  if [ -z "$LINE" ]; then
    echo "CAUSE=default-assignment-not-found — $FANIN defines runMechanicalFanIn but carries no 'const mergeTarget = opts.mergeTarget ?? ...' line; the default merge-target expression was refactored — re-anchor this criterion" >&2; exit 1
  fi


  case "$LINE" in
    *'"develop"'*) echo "OK — mechanical fan-in ($FANIN) mergeTarget default: ${LINE#*:}"; exit 0 ;;
    *) echo "CAUSE=default-not-develop — mechanical fan-in ($FANIN) mergeTarget default no longer defaults to \"develop\": ${LINE#*:}" >&2; exit 1 ;;
  esac

  CRIT
expect: criterion exits 0 as long as the module that defines runMechanicalFanIn
  still defaults its merge target to develop
origin: 本方案不改变 fan-in 目标，需要一条判据防止未来意外漂移
activatedAt: 2026-09-17T04:11:33.576Z
statusLog:
  - at: 2026-09-17T04:11:33.576Z
    from: draft
    to: active
    actor: manager
    reason: GOAL-023 激活，同步激活；判据已收紧为对 mergeTarget 默认赋值语句的位置判定
  - at: 2026-09-17T04:27:19.863Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-17T04:11:33.575Z
---
