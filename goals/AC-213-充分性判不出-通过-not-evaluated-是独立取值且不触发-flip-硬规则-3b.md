---
id: AC-213
title: 充分性判不出 ≠ 通过——not-evaluated 是独立取值且不触发 flip（硬规则 3b）
status: achieved
kind: criterion
goal: GOAL-010
criterion: node --no-warnings --experimental-strip-types --test
  plugin/test/goal-sufficiency-not-evaluated.test.mjs
expect: 单测证明 sufficiency=not-evaluated 时不触发 GOAL flip，且该取值在轮记录里可区分于
  covered——「判不出」不与「通过」同形，语义半不可用时 GOAL 不会被静默放行关闭（硬规则 3b）。
origin: 硬规则
  3b（判定机件在读不懂输入时不得返回与合格同形的值）在本仓已有三次同日实测：task-status-drift-check.ts:126（acSection
  读不到 ⇒ 零未勾 ⇒ 判完成）、slot-refill.ts:373（total===0 ⇒ 第一行就判
  landed）、outer-tick-log-check.sh（ACTION 解析不出 ⇒ 每条分支跳过 ⇒ 打印 PASS）。充分性闸把 LLM 引入
  GOAL 的关闭路径：若「判不出」与「覆盖」同形，语义半不可用时全部 GOAL 会静默放行关闭——那比没有这道闸更贵（一个恒绿的检查是假的保证）。故
  not-evaluated 必须是独立取值，且不得触发 flip。
statusLog:
  - at: 2026-09-09T11:32:17.158Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
