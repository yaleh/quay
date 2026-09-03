---
id: gap-retire-session-liveness
title: 退役 session-liveness（含 mount + 22 个测试 + monitor-mount-check + 引用清理），随 tmux 退役
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

tmux 机制即将退役，`session-liveness` 的 SESSION-GONE / SESSION-IDLE 两类事件读的是 **tmux pane**（claude 进程存在性 + pane 忙闲形状），随 tmux 一起退役。

**退役范围**：
1. 脚本：`plugin/scripts/session-liveness.sh`、`plugin/scripts/session-liveness-mount.sh`。
2. 测试：`plugin/test/session-liveness-*.test.mjs`（22 个：decision-import / events / hangguard / heartbeat / restart / scd-{busy,fire,inflight-changing,multitask,progress,config-gates,develop-active,unsaturated} / signals-{integration,kinds,thresholds-edge,thresholds-observers,thresholds} / sweep / target）。
3. 连带：`plugin/scripts/monitor-mount-check.sh` + `plugin/test/monitor-mount-check.test.mjs`（它专门检查 session-liveness 是否挂载，session-liveness 退役后无对象可查）。
4. 引用清理：20 个引用脚本里对 session-liveness 的引用，逐个移除或改判（缺 session-liveness 后不得报「未挂载」类恒红）。

**关键约束**：退役是「删 + 清引用」，不是「改判据」——凡依赖 session-liveness 输出（SESSION-* 事件 / monitor 挂载）的下游，要么一并退役该下游分支，要么改成不再依赖它（硬规则 5 来源完备性：删完 grep 命中数归零，不得留悬空引用）。

## Plan

1. 枚举 session-liveness 的全部消费方（20 个引用脚本 + CLAUDE.md / orchestration 文档 / skill 里的引用），确认哪些是「可删」、哪些是「需改判」。
2. 删：session-liveness.sh + session-liveness-mount.sh + 22 个测试 + monitor-mount-check.sh + monitor-mount-check.test.mjs。
3. 清引用：20 个脚本逐个移除 session-liveness 引用；下游「因缺 session-liveness 而恒红」的分支一并退役或改判（不得留「session-liveness 没挂载 ⇒ 报红」这类恒红检查）。
4. 全量 suite 绿（删测试后 ratchet/baseline 同步更新）。

## Acceptance Criteria

- [ ] AC1（能取假）：`grep -r "session-liveness" plugin/ scripts/ packages/ tasks/` 命中数归零（或仅剩「退役说明」注释），打印命中行。
- [ ] AC2（连带退役）：`monitor-mount-check.sh` / `monitor-mount-check.test.mjs` 一并删除（无对象可查）。
- [ ] AC3（无悬空引用）：凡引用 SESSION-* 事件 / session-liveness 输出的下游脚本，不得出现「因缺 session-liveness 而恒红/报未挂载」的分支。
- [ ] AC4（既有不回归）：全量 suite 绿（删测试后 @test-group ratchet / baseline 同步更新）。

## Definition of Done

session-liveness.sh / mount / 22 个测试 / monitor-mount-check 全部删除；20 个引用脚本里的 session-liveness 引用归零；下游无「因缺 session-liveness 恒红」的悬空分支；全量 suite 绿并可 `git show develop:` 核验删除落地。

## Touches

- plugin/scripts/session-liveness.sh（删）
- plugin/scripts/session-liveness-mount.sh（删）
- plugin/test/session-liveness-decision-import.test.mjs（删）
- plugin/test/session-liveness-events.test.mjs（删）
- plugin/test/session-liveness-hangguard.test.mjs（删）
- plugin/test/session-liveness-heartbeat.test.mjs（删）
- plugin/test/session-liveness-restart.test.mjs（删）
- plugin/test/session-liveness-scd-busy.test.mjs（删）
- plugin/test/session-liveness-scd-fire.test.mjs（删）
- plugin/test/session-liveness-scd-inflight-changing.test.mjs（删）
- plugin/test/session-liveness-scd-multitask.test.mjs（删）
- plugin/test/session-liveness-scd-progress.test.mjs（删）
- plugin/test/session-liveness-scd-config-gates.test.mjs（删）
- plugin/test/session-liveness-scd-develop-active.test.mjs（删）
- plugin/test/session-liveness-scd-unsaturated.test.mjs（删）
- plugin/test/session-liveness-signals-integration.test.mjs（删）
- plugin/test/session-liveness-signals-kinds.test.mjs（删）
- plugin/test/session-liveness-signals-thresholds-edge.test.mjs（删）
- plugin/test/session-liveness-signals-thresholds-observers.test.mjs（删）
- plugin/test/session-liveness-signals-thresholds.test.mjs（删）
- plugin/test/session-liveness-sweep.test.mjs（删）
- plugin/test/session-liveness-target.test.mjs（删）
- plugin/scripts/monitor-mount-check.sh（删）
- plugin/test/monitor-mount-check.test.mjs（删）
- plugin/scripts/accounting-emit.ts（清引用）
- plugin/scripts/accounting-emit-layer-map.ts（清引用）
- plugin/scripts/adr016-screen-use-check.ts（清引用）
- plugin/scripts/known-load-sensitive.ts（清引用）
- plugin/scripts/manager-observation-runtime-check.ts（清引用）
- plugin/scripts/manager-tick-readings.ts（清引用）
- plugin/scripts/inner-blocked-signal.ts（清引用）
- plugin/scripts/pane-state-classify.ts（清引用）
- plugin/scripts/quay-entry-base.ts（清引用）
- plugin/scripts/outer-cron-registry.ts（清引用）
- plugin/scripts/runner-static-gate.ts（清引用）
- plugin/scripts/prod-data-audit.ts（清引用）
- plugin/scripts/runner-concurrency.ts（清引用）
- plugin/scripts/full-suite-runner.ts（清引用）
- plugin/scripts/verify-delivery-surface.ts（清引用）
- plugin/scripts/tmux-test-isolation-check.ts（清引用）
- plugin/scripts/suite-state-trigger.ts（清引用）
- plugin/scripts/worktree-process-reaper.ts（清引用）
- plugin/scripts/manager-start.sh（清引用）
- tasks/gap-retire-session-liveness.md（自身）
