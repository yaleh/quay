---
id: AC-305
title: 仪器 0b 落地：sh-census-check 存在、--selftest 能取假、在真实仓库根给出 evaluated:true 且
  scripts>0 的有效读数
status: achieved
kind: criterion
goal: GOAL-025
criterion: |
  f=plugin/scripts/sh-census-check.ts
  [ -f "$f" ] || { echo "CAUSE=checker-missing — $f 不存在（Phase 0b 仪器未落地）" >&2; exit 1; }
  node --experimental-strip-types "$f" --selftest >/dev/null 2>&1 || { echo "CAUSE=selftest-failed — $f --selftest 非零（注入用例不能取假）" >&2; exit 1; }
  node --experimental-strip-types "$f" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.exit(j.evaluated===true&&j.totals&&j.totals.scripts>0&&Array.isArray(j.files)?0:1)}catch(e){process.exit(1)}})' || { echo "CAUSE=not-evaluated-on-real-tree — $f --json 在真实仓库根未给出 evaluated:true 且 scripts>0（读不懂输入不得伪装成合格）" >&2; exit 1; }
expect: exit 0（检查器存在 ∧ --selftest 通过 ∧ 真实仓库根 --json 给出
  evaluated:true、totals.scripts>0、files 为数组）。失败时 exit 1 且 stderr 携带 CAUSE=…；⛔
  echo … >&2 与 exit 1 写在同一行。
origin: SPEC-architecture-consolidation-ts-and-shell-2026-09-19 §5 Phase
  0b。实测缘由：上一轮汇报「397 个 .sh」被 .claude/worktrees 副本污染 10 倍以上（真值：tracked 236 个 / 真脚本
  144 个）——没有读数在盯 shell 层。
activatedAt: 2026-09-19T05:29:17.653Z
statusLog:
  - at: 2026-09-19T10:32:57.334Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
**对应任务**：`gap-arch-sh-census-check`（已立案）。

**口径要点**：数据源 `git ls-files '*.sh'`（禁用 find）；例外清单（控制面 shell、verify-deliver-coldstart）单列而不消失。

**不判**：内嵌解释器行数与副本数的具体值——它们由 AC-310 与后续 GOAL 判。