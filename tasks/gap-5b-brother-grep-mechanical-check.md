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

- [ ] AC1: fan-in 的 AC 完成闸要求【所有】任务体里有一条「同载体兄弟实例 grep 命中数」的行，**零命中也要写零**（对应硬规则② 的零计数复核半边）。**取消触发谓词**——「Touches 含修某处 X 类缺陷」是语义判断、不可机械评估，加谓词会「求值不出 ⇒ 分支跳过 ⇒ 闸恒绿」（硬规则 3b③ 的 outer-tick-log-check 形态）。对所有 fan-in 任务一律要求这一行（5b 本就不限于「5b 类任务」，任何「在一处修好 X」都适用）。
- [ ] AC2: 负控制落在生产载体——一个缺 grep 产物的任务 fan-in 被闸拦，补「命中数=0」后放行（读真实闸输出，非 fixture）。
- [ ] AC3: 闸上线后【首个真实拦截输出】贴进任务体——不是「测试证明能拦」，是「生产链路真的拦下过一次」（硬规则 4 推论三：只能被 fixture 满足的判据不是测量）。
- [ ] AC4: scoped 绿。

## Definition of Done

- [ ] 一个任务缺 grep 产物被 fan-in 闸拦（真实生产拦截，输出贴进任务体）、补产物后放行，守/不守从此可区分。

## Touches

- tasks/gap-5b-brother-grep-mechanical-check.md（自身）
- plugin/scripts/fan-in-ac-completion-gate.ts（AC 完成闸加「兄弟 grep 命中数」行检查，所有任务一律）
- plugin/test/fan-in-ac-completion-gate.test.mjs（缺产物拦 + 零命中放行负控制）
