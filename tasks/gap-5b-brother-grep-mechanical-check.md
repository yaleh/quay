---
id: gap-5b-brother-grep-mechanical-check
title: "5b 产物机械检查——fan-in AC 完成闸要求「同载体兄弟实例 grep 命中数」行（零命中写零），让守/不守可区分"
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

硬规则 5b 已有产物条款（「修完一个实例后在同一载体 grep 其它适用点，把命中数与前 3 条贴进提交」），但 2026-08-19 一日 4 例 5b 缺陷（第 13 条 measure-history 漏兄弟产物、第 18 条 leak 正则漏第二份、第 20 条 ol-scd-d 漏清理路径、第 21 条 worktree 当活性代理漏派发层），且 `7c755610`（ol-scd teardown）任务体里【没有】grep 产物（无命中数、无兄弟枚举）——**缺的不是规则，是规则没被执行，且没有任何机制会发现它没被执行**（硬规则 ⑨「守与不守在记录上无法区分 ⇒ 只能靠意志」的教科书形态）。

5b 已从「偶发认识论失误」变成【主要吞吐损耗源】：落地队列无并行路径，每个落在 suite 路径上的 5b 缺陷都自动成为全局串行点（第 20 条演示：4 小时、5 个完成的实现、零落地）。

## Acceptance Criteria

- [ ] AC1: 给 5b 产物加机械检查——凡 Touches 含「修某处 X 类缺陷」的任务，fan-in 的 AC 完成闸要求任务体里有一条「同载体兄弟实例 grep 命中数」的行，**零命中也要写零**（对应硬规则② 的零计数复核半边）。
- [ ] AC2: 负控制落在生产载体——一个缺 grep 产物的 5b 类任务，fan-in 被 AC 完成闸拦（读真实闸输出，非 fixture）；补上「命中数=0」后放行。
- [ ] AC3: scoped 绿 + 既有无 5b 任务的 fan-in 不受影响（只拦「Touches 含修 X 类」的任务）。

## Definition of Done

- [ ] 一个 5b 类任务缺 grep 产物被 fan-in 闸拦、补产物后放行（真实输出），守/不守从此可区分。

## Touches

- tasks/gap-5b-brother-grep-mechanical-check.md（自身）
- plugin/scripts/fan-in-ac-completion-gate.js（AC 完成闸加 5b grep 产物检查）
- plugin/test/fan-in-ac-completion-gate.test.mjs（缺产物拦 + 零命中放行负控制）
