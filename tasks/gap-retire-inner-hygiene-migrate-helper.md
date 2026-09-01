---
id: gap-retire-inner-hygiene-migrate-helper
title: inner 会话卫生退役 step1——迁活 helper 到非 inner 名（纯迁移不删），6 消费点 import 改指向
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

B/C 组 inner 会话卫生脚本退役第一步（**纯迁移，不删任何东西，风险最低**）。三个活 helper 迁到非 inner 名新文件，消费点改 import：

1. `inner-blocked-signal.ts` 的 `TASK_OVER_90M_MS` / `taskStatusAllowsOver90m` / `makeOver90ExecutorGone` → 新非 inner 名文件，`supervisor-preempt-candidates.ts` 改 import；
2. `inner-wakeup-heartbeat-check.ts` 的 `semanticTriggerHeuristic` / `freeTextHash` / `evaluateTrigger` → 新文件，`semantic-observer-judge.ts` 改 import；
3. `inner-exec-mode-report.ts` 的 `main_thread_edits` 判据 → manager 侧 checker，AC145 消费点改。

完成判据：typecheck + 相关测试绿，6 消费点 import 指向新机件。

## Plan

1. 迁移 `inner-blocked-signal.ts` 三 helper → 新文件（非 inner 名，worker 定），`supervisor-preempt-candidates.ts` 改 import。
2. 迁移 `inner-wakeup-heartbeat-check.ts` 三 helper → 新文件，`semantic-observer-judge.ts` 改 import。
3. 迁移 `inner-exec-mode-report.ts` 的 `main_thread_edits` 判据 → manager 侧 checker，AC145 消费点改。
4. 新文件在实现时补入 Touches（⛔ 本任务不删②类面，留 step2）。

## Acceptance Criteria

- [ ] AC1（能取假，迁移完成）：6 消费点 import 指向新非 inner 名机件——grep 消费点文件无旧 inner 文件 import；（⛔ 仍 import 旧 inner 文件 ⇒ 假）。
- [ ] AC2（能取假，无回归）：typecheck + 相关测试绿（纯迁移不改行为，只改名）。

## Definition of Done

三个活 helper 迁到非 inner 名新文件、6 消费点 import 改指向、typecheck 与相关测试绿、不删任何②类会话卫生面（纯迁移，删面留 step2）。

## Touches

- plugin/scripts/inner-blocked-signal.ts（迁出三 helper，②类面留 step2）
- plugin/scripts/supervisor-preempt-candidates.ts（import 改指向）
- plugin/scripts/inner-wakeup-heartbeat-check.ts（迁出三 helper）
- plugin/scripts/semantic-observer-judge.ts（import 改指向）
- plugin/scripts/inner-exec-mode-report.ts（迁出 main_thread_edits 判据）
- tasks/gap-retire-inner-hygiene-migrate-helper.md（自身）
