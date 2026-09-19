---
id: AC-311
title: capability-catalog 声明表离开 bash：capability-catalog.sh 内 [key]="…" 声明行 = 0，且
  --summary 入口仍 exit 0
status: active
kind: criterion
goal: GOAL-025
criterion: >
  n=$(grep -cE '^\s*\[[A-Za-z0-9._-]+\]="'
  plugin/scripts/capability-catalog.sh); [ "$n" -eq 0 ] || { echo
  "CAUSE=declaration-table-still-in-bash — capability-catalog.sh 仍含 $n 行
  [key]=\"…\" 声明（表未数据化）" >&2; exit 1; }

  bash plugin/scripts/capability-catalog.sh --summary >/dev/null 2>&1 || { echo
  "CAUSE=catalog-entry-gate-broken — --summary 非零（数据化后入口/未声明门失效）" >&2; exit 1; }
expect: exit 0（capability-catalog.sh 内 `[key]="…"` 形声明行数 = 0 ∧ `bash
  plugin/scripts/capability-catalog.sh --summary` exit 0）。失败时 exit 1 且 stderr 携带
  CAUSE=…（declaration-table-still-in-bash / catalog-entry-gate-broken）；⛔ echo …
  >&2 与 exit 1 写在同一行。
origin: SPEC-architecture-consolidation-ts-and-shell-2026-09-19 §5 Phase 4 / §2
  P3。实测（2026-09-19）：capability-catalog.sh 共 2395 行，声明表约 1907 行在 bash 里（0 个函数、22
  处 node），已有 10 个 TS 调用者与 13 个测试。数据不是代码。新脚本登记习惯可能把声明写回 bash，故 long-term:true。
activatedAt: 2026-09-19T05:29:27.496Z
long-term: true
---
**范围**：声明表改为数据文件，渲染与「未声明即非零退出」入口闸（原文件头 AC1c）改由 TS 实现；**保留 `bash plugin/scripts/capability-catalog.sh` 作为薄入口至少一个发布周期**（CLAUDE.md 把它指为「唯一清单」，入口不可断）。

**迁移前后必须一致**：`--summary` 的 `N scripts` 自报值逐字一致；新增一个未声明脚本，入口闸仍非零退出（迁前迁后各跑一次）。

**注意（派发）**：所有「新增/搬移/删除脚本」的任务都要改 capability-catalog.sh，本条会与它们串行；其合并冲突已知是关联数组并集。