---
id: gap-dispatch-brief-dod-check-timing
title: "派发 brief「不勾 DoD」与 fan-in gate「DoD 必勾」时序张力——impl 应勾 impl-time 项、fan-in 勾 fan-in-time 项，非「全不勾」"
status: todo
labels:
  - gap
  - process
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

inner 派发 brief 写「不勾 DoD（全量绿在 scoped-only 下不可知）」，而 `fan-in-ac-completion-gate` 要求 DoD 已勾才翻 done ⇒ **每个任务都撞这同一道 gate**（suite-fix-relaunch + phase-overlap 两例 needs-human）。正解：impl 勾 impl-time 可判的 DoD 项（scoped 绿），fan-in 勾 fan-in-time 项（全量绿 + 行为性后果由 fix 机制蕴含），不是「全不勾」。

## Acceptance Criteria

- [ ] AC1: 派发 brief 的 DoD 勾选指引改为「impl 勾 impl-time 项 / fan-in 勾 fan-in-time 项」，不再「全不勾」。
- [ ] AC2: 负控制——一个任务按新指引派发后，fan-in gate 不再因「DoD 全不勾」拒翻（DoD 项在正确时机被勾）。

## Definition of Done

- [ ] 一个任务走完派发→fan-in 且 DoD 在正确时机被勾（非 fan-in 被 gate 挡后补勾）。
