---
id: AC-286
title: worker 机械 fan-in 的合并目标仍然是 develop（回归防护）
status: achieved
kind: criterion
goal: GOAL-023
criterion: >-
  bash <<'CRIT'

  set -euo pipefail

  SRC="plugin/scripts/worker-fan-in.ts"

  if [ ! -f "$SRC" ]; then
    echo "CAUSE=source-absent — $SRC does not exist" >&2; exit 1
  fi

  LINE="$(grep -nE
  'const[[:space:]]+mergeTarget[[:space:]]*=[[:space:]]*opts\.mergeTarget'
  "$SRC" | head -1 || true)"

  if [ -z "$LINE" ]; then
    echo "CAUSE=default-assignment-not-found — no line in $SRC assigns 'const mergeTarget = opts.mergeTarget ?? ...' — the mechanical fan-in's default merge-target expression may have been refactored; this criterion needs updating, not silently passed" >&2; exit 1
  fi

  case "$LINE" in
    *'"develop"'*) echo "OK — $SRC's mergeTarget default assignment is: ${LINE#*:}"; exit 0 ;;
    *) echo "CAUSE=default-not-develop — $SRC's mergeTarget default assignment no longer defaults to \"develop\": ${LINE#*:}" >&2; exit 1 ;;
  esac

  CRIT
expect: criterion exits 0 as long as the mechanical fan-in's merge-target default
  assignment still defaults to develop. ⛔ The probe anchor is `plugin/scripts/worker-fan-in.ts`
  (where `const mergeTarget = opts.mergeTarget ?? "develop"` lives, line 1138) — the expression
  moved there out of `worker-driver.ts` without the guarantee changing; only the anchor followed
  the symbol (gap-ac241-errexit-abort-silent-failures-have-no-predicate)
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
