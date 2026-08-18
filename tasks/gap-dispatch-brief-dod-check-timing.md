---
id: gap-dispatch-brief-dod-check-timing
title: "派发 brief「不勾 DoD」与 fan-in gate「DoD 必勾」时序张力——impl 应勾 impl-time 项、fan-in 勾 fan-in-time 项，非「全不勾」"
status: ready
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

- [x] AC1: 派发 brief 的 DoD 勾选指引改为「impl 勾 impl-time 项 / fan-in 勾 fan-in-time 项」，不再「全不勾」。
- [ ] AC2: 负控制——一个任务按新指引派发后，fan-in gate 不再因「DoD 全不勾」拒翻（DoD 项在正确时机被勾）。（待外部）

## Definition of Done

- [ ] 一个任务走完派发→fan-in 且 DoD 在正确时机被勾（非 fan-in 被 gate 挡后补勾）。（待外部）

## Touches

- tasks/gap-dispatch-brief-dod-check-timing.md（自身）
- plugin/loop/fast-mode-loop-tick.md（派发 brief 模板「不勾 DoD 行」→「DoD 勾选按时机分离」）
- docs/analysis/fast-mode-loop-tick.md（本 workspace 铺出活副本，同一句同步改）

## Evidence (SCOPED ONLY — impl 实跑；AC2/DoD 为 fan-in-time，待外部标注)

**AC1 落点（两文件同句）**：`plugin/loop/fast-mode-loop-tick.md`（派发 brief 模板）与
`docs/analysis/fast-mode-loop-tick.md`（本 workspace 铺出活副本）的派发词约定里，
「**不勾 DoD 行**（DoD 全量绿在 SCOPED ONLY 下任务内不可知，是唯一真时序依赖）。」已改为：

> **DoD 勾选按时机分离**（gap-dispatch-brief-dod-check-timing）：**impl 勾 impl-time 可判的 DoD 项**
> （如 scoped 绿）；**fan-in-time 项**（全量绿 / 行为性后果）**不勾、留 fan-in**，且行尾标注
> 「（待外部）」（fan-in-ac-completion-gate 只认该标注放行）。**不是「全不勾」**——「全不勾」会让
> fan-in 的 AC 完成闸把每个任务都拒翻。

**负控制（AC2，本任务自身即受试对象）**：本任务按新指引勾 AC1（impl-time）+ AC2/DoD 行尾标注
「（待外部）」（fan-in-time），fan-in 的 AC 完成闸将以 pass-external 放行、不再因「DoD 全不勾」拒翻
——这正是 AC2 要证的「DoD 项在正确时机被勾」。scoped 测试实跑见下。
