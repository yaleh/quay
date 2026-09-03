---
id: gap-retire-session-liveness
title: 退役 session-liveness（含 mount + 22 个测试 + monitor-mount-check + 引用清理），随 tmux 退役
status: needs-human
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
4. 引用清理：session-liveness 的引用遍布全仓（orchestration/packages/plugin/loop/scripts/test/skills/workflows），逐个移除或改判（缺 session-liveness 后不得报「未挂载」类恒红）。

**关键约束**：退役是「删 + 清引用」，不是「改判据」——凡依赖 session-liveness 输出（SESSION-* 事件 / monitor 挂载）的下游，要么一并退役该下游分支，要么改成不再依赖它（硬规则 5 来源完备性：删完 grep 命中数归零，不得留悬空引用）。

**⛔ 方向（人 2026-09-03 裁决「彻底删，而非重命名」）**：前几轮 worker 误把 session-liveness 引用**重命名**为不存在的 `hermetic-tmux.sh` / `hermetic-tmux-mount-check.sh`（`plugin/skills/{init,manager}/SKILL.md`、`plugin/test/quay-init-*.test.mjs`、`cold-start-skill.test.mjs` 等），这是方向错误。正确做法是**删除**这些引用（改判或删分支），**不得**引入任何 `hermetic-tmux.sh` / `hermetic-tmux-mount-check.sh` 新脚本引用。repo 已有的 `plugin/test/helpers/hermetic-tmux.mjs` 测试 helper 与本次退役无关，保持原样不动。

## Plan

1. 枚举 session-liveness 的全部消费方（147 个文件：orchestration 文档 / packages 代码 / plugin/loop 文档 / plugin/scripts / plugin/test / skills / workflows / scripts/test.sh），确认哪些是「可删」、哪些是「需改判」。
2. 删：session-liveness.sh + session-liveness-mount.sh + session-liveness-sweep*.mjs（重命名 run-namespace-sweep*）+ 22 个测试 + monitor-mount-check.sh + monitor-mount-check.test.mjs。
3. 清引用：逐个移除 session-liveness 引用；下游「因缺 session-liveness 而恒红」的分支一并退役或改判。
4. 全量 suite 绿（删测试后 ratchet/baseline + bucket 归因同步更新）。

## Acceptance Criteria

- [ ] AC1（能取假）：`grep -rE "session-liveness|hermetic-tmux\.sh|hermetic-tmux-mount-check\.sh" plugin/ scripts/ packages/ orchestration/` 命中数归零（或仅剩「退役说明」注释），打印命中行；`hermetic-tmux.sh` / `hermetic-tmux-mount-check.sh` 是前几轮误引入的重命名悬空引用，一并删除（`plugin/test/helpers/hermetic-tmux.mjs` 不在本范围）。
- [ ] AC2（连带退役）：`monitor-mount-check.sh` / `monitor-mount-check.test.mjs` 一并删除（无对象可查）。
- [ ] AC3（无悬空引用）：凡引用 SESSION-* 事件 / session-liveness 输出的下游脚本，不得出现「因缺 session-liveness 而恒红/报未挂载」的分支。
- [ ] AC4（既有不回归）：全量 suite 绿（删测试后 @test-group ratchet / baseline / suite-bucket-reattribution 同步更新）。

## Definition of Done

session-liveness.sh / mount / sweep 脚本 / 22 个测试 / monitor-mount-check 全部删除；147 个文件里的 session-liveness 引用归零；下游无「因缺 session-liveness 恒红」的悬空分支；全量 suite 绿并可 `git show develop:` 核验删除落地。

## Touches

- .quay/suite-bucket-reattribution.jsonl
- docs/analysis/test-file-baseline.txt
- orchestration/fast-mode-tick-core.md
- orchestration/manager-loop-tick.md
- orchestration/manager-tick-core.md
- orchestration/orchestrator-loop-tick.md
- orchestration/orchestrator-tick-core.md
- packages/quay/src/init.ts
- packages/quay/src/observation.ts
- packages/quay/src/serve-dashboard.ts
- packages/quay/src/serve-system.ts
- packages/quay/test/build-plugin-dist.test.mjs
- packages/quay/test/driver-helpers.mjs
- packages/quay/test/gap-dashboard-parallelize.test.mjs
- packages/quay/test/init.test.mjs
- packages/quay/test/install-config-driven-e2e-runtime.test.mjs
- packages/quay/test/install-config-driven-e2e-upgrade.test.mjs
- packages/quay/test/install-config-driven-e2e.test.mjs
- packages/quay/test/lifecycle-helpers.mjs
- packages/quay/test/observation.test.mjs
- packages/quay/test/serve-ac95-views.test.mjs
- plugin/loop/fast-mode-loop-tick.md
- plugin/loop/fast-mode-tick-core.md
- plugin/loop/orchestrator-loop-tick.md
- plugin/scripts/accounting-emit-layer-map.ts
- plugin/scripts/accounting-emit.ts
- plugin/scripts/adr016-screen-use-check.ts
- plugin/scripts/capability-catalog.sh
- plugin/scripts/checker-mutation-cases/adr016-screen-use-check.sh
- plugin/scripts/checker-mutation-cases/red-on-omission-audit.sh
- plugin/scripts/dead-loop-check.sh
- plugin/scripts/deliver-verify-usage.sh
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/inner-blocked-signal.ts
- plugin/scripts/known-load-sensitive.ts
- plugin/scripts/laydown-set-check.sh
- plugin/scripts/loop-driver-check.sh
- plugin/scripts/loop-shipping-exclusion-data.mjs
- plugin/scripts/manager-start.sh
- plugin/scripts/manager-tick-readings.ts
- plugin/scripts/monitor-mount-check.sh
- plugin/scripts/observer-registry-check.sh
- plugin/scripts/observer-registry.sh
- plugin/scripts/os-anchor-install.sh
- plugin/scripts/os-anchor-watchdog.sh
- plugin/scripts/outer-cron-registry.ts
- plugin/scripts/outer-driver.ts
- plugin/scripts/outer-session-check.sh
- plugin/scripts/pane-state-classify.ts
- plugin/scripts/process-budget.sh
- plugin/scripts/prod-data-audit.ts
- plugin/scripts/quay-entry-base.ts
- plugin/scripts/quay-init.sh
- plugin/scripts/quay-session.ts
- plugin/scripts/quay-topology.sh
- plugin/scripts/run-namespace-sweep-kill.mjs
- plugin/scripts/run-namespace-sweep.mjs
- plugin/scripts/runner-concurrency.ts
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/send-keys-reliable.sh
- plugin/scripts/session-bootstrap.sh
- plugin/scripts/session-liveness-mount.sh
- plugin/scripts/session-liveness.sh
- plugin/scripts/suite-state-trigger.ts
- plugin/scripts/supervisor-health.sh
- plugin/scripts/tmux-isolated.sh
- plugin/scripts/tmux-leak-scan.sh
- plugin/scripts/tmux-test-isolation-check.ts
- plugin/scripts/topology-check.sh
- plugin/scripts/verify-deliver-coldstart.sh
- plugin/scripts/verify-delivery-surface.ts
- plugin/scripts/verify-installed-executables.sh
- plugin/scripts/worktree-process-reaper.ts
- plugin/skills/cold-start/SKILL.md
- plugin/skills/init/SKILL.md
- plugin/skills/manager/SKILL.md
- plugin/skills/session-topology/SKILL.md
- plugin/test/accounting-emit-layer-map.test.mjs
- plugin/test/accounting-emit.test.mjs
- plugin/test/adr016-screen-use-check.test.mjs
- plugin/test/blocked-signal-parameterized.test.mjs
- plugin/test/cold-start-skill.test.mjs
- plugin/test/execute-suite-fix-scope-gate.test.mjs
- plugin/test/fan-in-execute-paths.test.mjs
- plugin/test/full-suite-runner-phases.test.mjs
- plugin/test/full-suite-runner.test.mjs
- plugin/test/help-contract-incompatible-behaviors.test.mjs
- plugin/test/instrument-failure-check.test.mjs
- plugin/test/integration-batch-merge.test.mjs
- plugin/test/known-load-sensitive.test.mjs
- plugin/test/launch-settings.test.mjs
- plugin/test/laydown-set-check.test.mjs
- plugin/test/loop-driver-check.test.mjs
- plugin/test/loop-shipping.test.mjs
- plugin/test/manager-cold-start.test.mjs
- plugin/test/manager-layer-shipping.test.mjs
- plugin/test/manager-layer-skill.test.mjs
- plugin/test/manager-start.test.mjs
- plugin/test/manager-tick-core.test.mjs
- plugin/test/manager-tick-readings.test.mjs
- plugin/test/monitor-mount-check.test.mjs
- plugin/test/observer-registry.test.mjs
- plugin/test/outer-cron-registry.test.mjs
- plugin/test/outer-loop-tick-split.test.mjs
- plugin/test/outer-retirement-precondition-check.test.mjs
- plugin/test/pane-state-classify.test.mjs
- plugin/test/prod-data-audit.test.mjs
- plugin/test/quay-init-loop-core.test.mjs
- plugin/test/quay-init-loop-driver.test.mjs
- plugin/test/quay-init-loop-runtime.test.mjs
- plugin/test/quay-init-tmux-detection.test.mjs
- plugin/test/quay-session.test.mjs
- plugin/test/ready-pool-check.test.mjs
- plugin/test/red-window-triage.test.mjs
- plugin/test/send-keys-reliable.test.mjs
- plugin/test/session-liveness-decision-import.test.mjs
- plugin/test/session-liveness-events.test.mjs
- plugin/test/session-liveness-hangguard.test.mjs
- plugin/test/session-liveness-heartbeat.test.mjs
- plugin/test/session-liveness-helpers.mjs
- plugin/test/session-liveness-restart.test.mjs
- plugin/test/session-liveness-scd-busy.test.mjs
- plugin/test/session-liveness-scd-config-gates.test.mjs
- plugin/test/session-liveness-scd-develop-active.test.mjs
- plugin/test/session-liveness-scd-fire.test.mjs
- plugin/test/session-liveness-scd-inflight-changing.test.mjs
- plugin/test/session-liveness-scd-multitask.test.mjs
- plugin/test/session-liveness-scd-progress.test.mjs
- plugin/test/session-liveness-scd-unsaturated.test.mjs
- plugin/test/session-liveness-signals-integration.test.mjs
- plugin/test/session-liveness-signals-kinds.test.mjs
- plugin/test/session-liveness-signals-thresholds-edge.test.mjs
- plugin/test/session-liveness-signals-thresholds-observers.test.mjs
- plugin/test/session-liveness-signals-thresholds.test.mjs
- plugin/test/session-liveness-sweep.test.mjs
- plugin/test/session-liveness-target.test.mjs
- plugin/test/suite-bucket-attribution.test.mjs
- plugin/test/suite-bucket-load-sensitive-isolation.test.mjs
- plugin/test/supervisor-health.test.mjs
- plugin/test/tmux-leak-scan.test.mjs
- plugin/test/user-scope-reinstall.test.mjs
- plugin/test/verify-deliver-coldstart.test.mjs
- plugin/test/worktree-process-reaper.test.mjs
- plugin/workflows/execute-suite-fix.js
- plugin/workflows/fan-in-execute.js
- scripts/test.sh
- tasks/gap-retire-session-liveness.md（自身）

## Needs-Human

**执行 2026-09-03T11:00:21.670Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=merge-develop: Auto-merging tasks/gap-retire-session-liveness.md
CONFLICT (content): Merge conflict in tasks/gap-retire-session-liveness.md
Automatic merge failed; fix conflicts and then commit the result.
- run_id：wk-prod-1788285192
- session_id：dff30fd4-bc1b-4ce7-a507-cb6fd599cd98
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-retire-session-liveness-wk-prod-1788285192.log

## Needs-Human

**执行 2026-09-03T11:36:29.287Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=scoped-gate: FAIL (referenced-not-landed): plugin/scripts/session-liveness-mount — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    actual: 2,
    expected: 0,
✖ explicit --tmux-session takes priority over detection (the fallback the human controls) (8181.979173ms)
  AssertionError [ERR_ASSERTION]: init must exit 0:
    FAIL (referenced-not-landed): plugin/scripts/hermetic-tmux-mount-check.sh — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    FAIL (referenced-not-landed): plugin/scripts/hermetic-tmux.sh — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    FAIL (referenced-not-landed): plugin/scripts/monitor-mount-check — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    FAIL (referenced-not-landed): plugin/scripts/session-liveness — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    FAIL (referenced-not-landed): plugin/scripts/session-liveness-mount — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    actual: 2,
    expected: 0,
✖ AC2 — the three exec-core docs are in the derived laydown set; a --loop install lays them to orchestration/ (23712.467886ms)
    FAIL (referenced-not-landed): plugin/scripts/hermetic-tmux-mount-check.sh — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    FAIL (referenced-not-landed): plugin/scripts/hermetic-tmux.sh — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    FAIL (referenced-not-landed): plugin/scripts/monitor-mount-check — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    FAIL (referenced-not-landed): plugin/scripts/session-liveness — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    FAIL (referenced-not-landed): plugin/scripts/session-liveness-mount — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
✖ AC2-launch — --loop lays down .claude/launch.settings.json + .quay/profiles.yml; the laid-down quay-launch.sh materializes --settings + role names (21180.243017ms)
    FAIL (referenced-not-landed): plugin/scripts/hermetic-tmux-mount-check.sh — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    FAIL (referenced-not-landed): plugin/scripts/hermetic-tmux.sh — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    FAIL (referenced-not-landed): plugin/scripts/monitor-mount-check — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    FAIL (referenced-not-landed): plugin/scripts/session-liveness — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    FAIL (referenced-not-landed): plugin/scripts/session-liveness-mount — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
✖ AC3 — manager-tick-core.md is OPT-IN: absent in a default --loop, present with --manager (20769.393704ms)
    FAIL (referenced-not-landed): plugin/scripts/hermetic-tmux-mount-check.sh — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    FAIL (referenced-not-landed): plugin/scripts/hermetic-tmux.sh — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    FAIL (referenced-not-landed): plugin/scripts/monitor-mount-check — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    FAIL (referenced-not-landed): plugin/scripts/session-liveness — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md
    FAIL (referenced-not-landed): plugin/scripts/session-liveness-mount — referenced by a shipped skill/tick doc but 
- run_id：wk-prod-1788285192
- session_id：07da2d54-9229-40b3-9909-8c4cd2e5342c
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-retire-session-liveness-wk-prod-1788285192.log
