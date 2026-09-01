---
id: gap-retire-inner-hygiene-delete-session-face
title: inner 会话卫生退役 step2——删②类面（--detect-stop/--pane/tmux-Monitor/main_thread_edits/wakeup-heartbeat CLI）+ AC149 doc-marking
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-retire-inner-hygiene-migrate-helper
---
**type:** execution

## Proposal

step1 迁完活 helper 后，删②类会话卫生面（`--detect-stop` / `--pane` / 落盘 / tmux-Monitor 挂载 / `main_thread_edits` 两数 / wakeup-heartbeat CLI）+ AC149 doc-marking（`fast-mode-tick-core.md` A8 等引用行删除/标注，shipped tick doc referenced ⊆ landed）。`monitor-mount-check.sh` / `inner-session-check.sh` 活功能改名/改注释（⛔ 非删机件）。

## Plan

1. 删 `inner-blocked-signal.ts --detect-stop` / 落盘面、`inner-panel-stale-check.ts --pane`、`inner-wakeup-heartbeat.ts` wakeup-heartbeat CLI、`main_thread_edits` 两数面（step1 已迁出的判据/helper 不动）。
2. AC149 doc-marking：`orchestration/fast-mode-tick-core.md` A8 等 inner 会话卫生引用行删除/标注。
3. `monitor-mount-check.sh` / `inner-session-check.sh` 活功能改名/改注释（非删）。

## Acceptance Criteria

- [ ] AC1（能取假，②类面清）：②类 CLI（--detect-stop/--pane/落盘/tmux-Monitor/main_thread_edits/wakeup-heartbeat）删除或改名——grep 无活调用；（⛔ 仍活 ⇒ 假）。
- [ ] AC2（能取假，doc-marking）：shipped tick doc 里 A8 等 inner 会话卫生引用行删除/标注（referenced ⊆ landed）；（⛔ 引用仍在且无标注 ⇒ 假）。

## Definition of Done

②类会话卫生面 CLI（--detect-stop/--pane/tmux-Monitor 挂载/main_thread_edits 两数/wakeup-heartbeat）删除或改名、AC149 doc-marking 落地、typecheck 与相关测试绿、活功能改名/改注释保留。

## Touches

- plugin/scripts/inner-blocked-signal.ts（删 --detect-stop / 落盘面）
- plugin/scripts/inner-panel-stale-check.ts（删 --pane 面）
- plugin/scripts/inner-wakeup-heartbeat.ts（删 wakeup-heartbeat CLI）
- plugin/scripts/monitor-mount-check.sh（活功能改名/改注释）
- plugin/scripts/inner-session-check.sh（活功能改名/改注释）
- orchestration/fast-mode-tick-core.md（A8 等引用行 doc-marking）
- tasks/gap-retire-inner-hygiene-delete-session-face.md（自身）
