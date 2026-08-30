---
id: gap-needs-human-note-carries-step-verdict
title: needs-human 注记携带实际失败步+判词——不再写模板「连续 3 次 exited-not-landed」压扁真因
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`markNeedsHuman` 写 `## Needs-Human` 段的阻碍原因用模板「worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）」，压扁了完全不同真因。实证 gap-execution-loop 两次 needs-human 逐字相同（一次 anti-drift SIGPIPE、一次 merge 冲突+AC 未完成）——读注记无法区分。应携带 mechanical_fan_in.step + verdict（如 ac-gate: checked 1/6；suite red: full-suite-runner.test.mjs:4889 ENOTEMPTY）。

## Plan

`markNeedsHuman` 的 reason 构造改读最近 exited-not-landed 记录的 `mechanical_fan_in.step` + `reason/verdict`（复用 lastExitedNotLandedReason 的读法），拼接进 `## Needs-Human` 阻碍原因。

## Acceptance Criteria

- [ ] AC1（能取假，注记带 step）：needs-human 注记含失败 step（grep 到 ac-gate/suite/merge-develop 等实际步名）；（⛔ 仍只有模板句 ⇒ 假）。
- [ ] AC2（能取假，单测）：driver-filters.test.mjs 断言「needs-human reason 含 step+verdict 非纯模板」，改掉任一 ⇒ 红。

## Definition of Done

needs-human 注记带实际失败步+判词；AC1-AC2 全勾；全量 suite 绿。

## Touches

- plugin/scripts/driver-filters.ts（markNeedsHuman reason 读 mechanical_fan_in.step+verdict）
- plugin/test/driver-filters.test.mjs（AC2 单测）
- tasks/gap-needs-human-note-carries-step-verdict.md（自身）
