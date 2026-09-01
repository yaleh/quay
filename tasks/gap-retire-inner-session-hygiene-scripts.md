---
id: gap-retire-inner-session-hygiene-scripts
title: B/C 组 inner 会话卫生脚本退役——先迁活 helper 再删 --detect-stop/--pane/tmux-Monitor 挂载/落盘/main_thread_edits/wakeup-heartbeat 面，同步 catalog/测试
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---

## Proposal

AC148（`orchestration/AC148-inner-core-itemized-attribution.md`，done）把 fast-mode-tick-core.md 的 16 条映射为「② 随会话消失」（A2/A7/A8/A23/A24/B3/B4 等），AC149（会话真退役，done）已退役 inner tmux 会话。但承载这些②类会话卫生功能的脚本仍被 outer/manager/supervisor/driver 活代码 import/实调，不能直接删：monitor-mount-check.sh（outer-driver A1 `monitor_mount` 读数 · manager-start idle-watch 挂载核对）、inner-blocked-signal.ts（supervisor-preempt-candidates 三 helper）、inner-exec-mode-report.ts（manager AC145 的 `main_thread_edits` 判据）、inner-wakeup-heartbeat-check.ts（semantic-observer-judge 三 helper）、inner-session-check.sh（manager-adopt:37 · quay-init · session-liveness · quay-session）。人 2026-09-01 裁定「inner 已退役机制，应退役其测试」。本任务做正确退役：先迁出活 helper/函数到非 inner 命名的机件，再删②类会话卫生面，同步 capability-catalog 六表与测试。gap-retire-inner-session-references（done）的执行记录已列 6 条消费方证据，复用不重查。

## Plan

1. 逐脚本分「②类会话卫生面 / ①类活 helper」两层，消费方证据复用 gap-retire-inner-session-references 执行记录（6 条）。
2. 先迁活 helper：inner-blocked-signal.ts 的 `TASK_OVER_90M_MS`/`taskStatusAllowsOver90m`/`makeOver90ExecutorGone` → 新非 inner 名文件，supervisor-preempt-candidates.ts 改 import；inner-wakeup-heartbeat-check.ts 的 `semanticTriggerHeuristic`/`freeTextHash`/`evaluateTrigger` → 新文件，semantic-observer-judge.ts 改 import；inner-exec-mode-report.ts 的 `main_thread_edits` 判据形态 → manager 侧 checker，AC145 消费点改。
3. 删②类会话卫生面：--detect-stop/--pane/落盘/tmux-Monitor 挂载/main_thread_edits 两数/wakeup-heartbeat CLI。
4. monitor-mount-check.sh / inner-session-check.sh 的活功能改名/改注释而非删（Plan step 6 判据）；inner-panel-stale-check.ts 退役前先做 AC149 doc-marking（fast-mode-tick-core.md A8 等引用行删除/标注，满足 shipped tick doc referenced ⊆ landed）。
5. 同步 capability-catalog.sh 六表（CADENCE「每轮」→退役、LAST_REAFFIRMED）+ 各自测试（inner-session-check / inner-idle-log / inner-forensics 测试去留）。

## Acceptance Criteria

- [ ] AC1（能取假，②类面清零）：B/C 组脚本的②类会话卫生面（--detect-stop/--pane/tmux-Monitor 挂载/落盘/main_thread_edits 两数/wakeup-heartbeat CLI）已删或迁移，全仓 grep 该面引用 = 0（归档/SPEC 文档豁免列清单）。
- [ ] AC2（能取假，活消费点改指新机件）：supervisor-preempt-candidates.ts / semantic-observer-judge.ts / manager AC145 判据 / outer-driver.ts / manager-adopt.sh / quay-init.sh 的 import/实调指向迁移后的新机件，typecheck 与相关测试绿。
- [ ] AC3（能取假，catalog 同步）：capability-catalog.sh 六表与本批脚本退役状态一致（CADENCE 不再「每轮」、LAST_REAFFIRMED 更新），capability-catalog.test.mjs 绿。
- [ ] AC4（能取假，无残留）：被删脚本的测试同步删/改，无「无测试的活脚本」或「无脚本的活测试」残留；`git grep` 被删脚本路径仅在归档/SPEC 文档命中。

## Definition of Done

B/C 组②类会话卫生面全部退役或迁移，活 helper 有非 inner 名的新家，outer/manager/supervisor/driver 消费点改指新机件，typecheck + suite 绿，capability-catalog 六表同步，无活脚本/活测试残留。

## Touches

- plugin/scripts/monitor-mount-check.sh
- plugin/scripts/inner-blocked-signal.ts
- plugin/scripts/inner-panel-stale-check.ts
- plugin/scripts/inner-exec-mode-report.ts
- plugin/scripts/inner-wakeup-heartbeat.ts
- plugin/scripts/inner-wakeup-heartbeat-check.ts
- plugin/scripts/inner-session-check.sh
- plugin/scripts/supervisor-preempt-candidates.ts
- plugin/scripts/semantic-observer-judge.ts
- plugin/scripts/outer-driver.ts
- plugin/scripts/manager-start.sh
- plugin/scripts/manager-adopt.sh
- plugin/scripts/quay-init.sh
- plugin/scripts/session-liveness.sh
- plugin/scripts/quay-session.ts
- plugin/scripts/capability-catalog.sh
- plugin/test/inner-session-check.test.mjs
- plugin/test/inner-idle-log.test.mjs
- plugin/test/inner-forensics.test.mjs
- tasks/gap-retire-inner-session-hygiene-scripts.md
