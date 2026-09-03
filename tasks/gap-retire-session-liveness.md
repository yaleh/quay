---
id: gap-retire-session-liveness
title: 退役 session-liveness（含 mount + 22 个测试 + monitor-mount-check + 引用清理），随 tmux 退役
status: ready
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

**方案 B（人 2026-09-03 裁定：idle-watch 随 session-liveness 一起退役）**：`idle-watch` 不是独立机制，它就是 session-liveness 的 manager 实例——`manager-start.sh` 里 `IDLE_WATCH_MOUNT_ENTRY = session-liveness-mount.sh`、`IDLE_WATCH_DELIVERY_SEAM = session-liveness.sh --once`，全库无独立 idle-watch 脚本。退役 session-liveness 连带 idle-watch：删 `--check-idle-watch` / `--ensure-mount-intent` 参数、`idle-watch.env` / `idle-watch-mount.txt` 工件、checklist 的 `IDLE-WATCH-MOUNTED` / `MONITORS-DELIVERING` 两键（7 键变 5 键）。**manager 自我观测的「定时/行为保持」能力，未来用 driver 机制替代**（本次不实现，只退役旧机制）。

## Plan

1. 枚举 session-liveness 的全部消费方（147 个文件：orchestration 文档 / packages 代码 / plugin/loop 文档 / plugin/scripts / plugin/test / skills / workflows / scripts/test.sh），确认哪些是「可删」、哪些是「需改判」。
2. 删：session-liveness.sh + session-liveness-mount.sh + session-liveness-sweep*.mjs（重命名 run-namespace-sweep*）+ 22 个测试 + monitor-mount-check.sh + monitor-mount-check.test.mjs。
3. 删 idle-watch 接缝（方案 B）：manager-start.sh 的 `--check-idle-watch` / `--ensure-mount-intent` 参数 + `IDLE_WATCH_MOUNT_ENTRY` / `IDLE_WATCH_DELIVERY_SEAM` + `idle-watch.env` / `idle-watch-mount.txt` 工件 + checklist 7 键删 2 键（IDLE-WATCH-MOUNTED / MONITORS-DELIVERING）；packages/quay/src/cli/manager.ts 的 `--check-idle-watch` CLI 参数。
4. 清引用（⛔ 活跃引用清单，逐个清/改判，不靠 fan-in 逐轮暴露）：
   - plugin/loop/（3）：fast-mode-loop-tick.md、fast-mode-tick-core.md、orchestrator-loop-tick.md
   - plugin/scripts/（19）：full-suite-runner.ts、inner-blocked-signal.ts、loop-shipping-exclusion-data.mjs、manager-observation-runtime-check.ts、manager-start.sh、manager-tick-readings.ts、observer-registry-check.sh、observer-registry.sh、os-anchor-install.sh、os-anchor-watchdog.sh、outer-driver.ts、pane-state-classify.ts、quay-init.sh、quay-session.ts、red-on-omission-audit.ts、run-namespace-sweep-kill.mjs、run-namespace-sweep.mjs、tmux-test-isolation-check.ts、verify-delivery-surface.ts
   - plugin/skills/（2）：cold-start/SKILL.md、manager/SKILL.md
   - plugin/test/（16）：blocked-signal-parameterized、cold-start-skill、help-contract-incompatible-behaviors、laydown-set-check、loop-shipping、manager-cold-start、manager-start、manager-tick-core、observer-registry、pane-state-classify、quay-init-loop-core、quay-init-loop-driver、quay-init-loop-runtime、quay-init-tmux-detection、session-bootstrap、suite-bucket-load-sensitive-isolation（各 .test.mjs）
   - packages/scripts/（2）：packages/quay/src/observation.ts、scripts/test.sh
   - orchestration/（活跃 loop 文档 + conf，7）：fast-mode-tick-core.md、manager-loop-tick.md、manager-tick-core.md、manager-tick-criteria.md、orchestrator-loop-tick.md、orchestrator-tick-core.md、observer-registry.conf
   - ⛔ orchestration/ 历史文档（SPEC-*/RUNBOOK-*/ANALYSIS-*/FINDING-*/PROPOSAL-*/RESEARCH-*/archive/*/escalations/inner-brief-*/manager-obligation-ledger.jsonl/*-phase-goal*/*-rulings-*/recovery-*/session-launch-recipes/tools-log/session-liveness.env）是历史记录，保留不清。
5. 全量 suite 绿（删测试后 ratchet/baseline + bucket 归因同步更新）。

## Acceptance Criteria

- [ ] AC1（能取假）：Plan 第 4 步「活跃引用清单」内文件，`grep -E "session-liveness|hermetic-tmux\.sh|hermetic-tmux-mount-check\.sh"` 命中归零，打印命中行；`hermetic-tmux.sh` / `hermetic-tmux-mount-check.sh` 是误引入的重命名悬空引用，一并删除（`plugin/test/helpers/hermetic-tmux.mjs` 不在本范围）；orchestration/ 历史文档（SPEC/RUNBOOK/ANALYSIS/archive 等）保留历史，不在归零范围。
- [ ] AC2（连带退役）：`monitor-mount-check.sh` / `monitor-mount-check.test.mjs` 一并删除（无对象可查）。
- [ ] AC3（无悬空引用）：凡引用 SESSION-* 事件 / session-liveness 输出的下游脚本，不得出现「因缺 session-liveness 而恒红/报未挂载」的分支。
- [ ] AC4（既有不回归）：全量 suite 绿（删测试后 @test-group ratchet / baseline / suite-bucket-reattribution 同步更新）。
- [ ] AC5（idle-watch 随退役）：`grep -rn "idle-watch\|IDLE_WATCH\|--check-idle-watch\|--ensure-mount-intent" plugin/ packages/ orchestration/` 命中数归零（或仅剩「退役说明/未来 driver 替代」注释）；manager 冷启动 checklist 7 键变 5 键（无 IDLE-WATCH-MOUNTED / MONITORS-DELIVERING）。

## Definition of Done

session-liveness.sh / mount / sweep 脚本 / 22 个测试 / monitor-mount-check 全部删除；147 个文件里的 session-liveness 引用归零；下游无「因缺 session-liveness 恒红」的悬空分支；全量 suite 绿并可 `git show develop:` 核验删除落地。

## Touches

- .quay/suite-bucket-reattribution.jsonl
- docs/analysis/test-file-baseline.txt
- orchestration/fast-mode-tick-core.md
- orchestration/manager-loop-tick.md
- orchestration/manager-tick-core.md
- orchestration/manager-tick-criteria.md
- orchestration/observer-registry.conf
- orchestration/orchestrator-loop-tick.md
- orchestration/orchestrator-tick-core.md
- packages/quay/src/cli/manager.ts
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
- plugin/scripts/manager-observation-runtime-check.ts
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
- plugin/scripts/red-on-omission-audit.ts
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
- plugin/test/direct-to-develop-bypass-check.test.mjs
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
- plugin/test/session-bootstrap.test.mjs
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
- .claude/workflows/execute-suite-fix.js
- .claude/workflows/fan-in-execute.js
- orchestration/session-config.env
- plugin/scripts/integration-batch-merge.sh
- plugin/scripts/manager-adopt.sh
- plugin/test/manager-productization.test.mjs
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

## Needs-Human

**执行 2026-09-03T13:55:42.318Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=scoped-gate: ✖ AC4 — both manifests carry six categories; auto-detection maps bundle→source and consumer→laid (2.875056ms)
✖ Contract control — removing one laid category's deliverables makes laid mode report it MISSING (145.402451ms)
✔ killProcs — already-exited pid counts as killed (fail-open); empty list is a no-op (2.717604ms)
ℹ fail 14
✖ failing tests:
✖ AC3 — manager-start.sh writes the idle-watch mount intent and dry-runs it (179.480275ms)
  AssertionError [ERR_ASSERTION]: dry-run must plan the idle-watch mount step
    actual: 'would-create-home: mkdir -p /home/yale/.quay-global/manager\nwould-write-identity: /home/yale/.quay-global/manager/identity\nwould-write-checklist: /home/yale/.quay-global/manager/cold-start-checklist.md\nwould-launch-session: tmux new-session -d -s quay-manager -n manager "bash /home/yale/work/quay-worktrees/gap-retire-session-liveness/plugin/scripts/quay-launch.sh manager"\nwould-arm-loop: /home/yale/work/quay-worktrees/gap-retire-session-liveness/plugin/scripts/manager-arm-loop.sh --home /home/yale/.quay-global/manager\n',
    expected: /would-mount-idle-watch/,
✖ AC3 — manager-start.sh --check-idle-watch is mechanically executable (two criteria + ok) (30.169075ms)
  AssertionError [ERR_ASSERTION]: check-idle-watch with no mounted monitor must exit 1 (fail-closed)
    actual: 2,
    expected: 1,
✖ AC1/AC7 — `quay manager adopt` requires a project root and is dry-runnable (three-state via outer-session-check) (1682.146537ms)
  AssertionError [ERR_ASSERTION]: adopt --dry-run must exit 0:
    actual: 2,
    expected: 0,
✖ AC3 — `quay manager adopt --dry-run` against a REAL outer window yields healthy (not missing) via outer-session-check.sh (2207.267586ms)
  AssertionError [ERR_ASSERTION]: adopt --dry-run must exit 0:
    actual: 2,
    expected: 0,
✖ AC2 — manager-start --dry-run plans the cold-start checklist + idle-watch config (154.471026ms)
  AssertionError [ERR_ASSERTION]: must plan writing <home>/idle-watch.env
    actual: 'would-create-home: mkdir -p /tmp/quay-mgr-start-8LlUXA/home\nwould-write-identity: /tmp/quay-mgr-start-8LlUXA/home/identity\nwould-write-checklist: /tmp/quay-mgr-start-8LlUXA/home/cold-start-checklist.md\nwould-launch-session: tmux new-session -d -s quay-manager -n manager "bash /home/yale/work/quay-worktrees/gap-retire-session-liveness/plugin/scripts/quay-launch.sh manager"\nwould-arm-loop: /home/yale/work/quay-worktrees/gap-retire-session-liveness/plugin/scripts/manager-arm-loop.sh --home /tmp/quay-mgr-start-8LlUXA/home\n',
    expected: /would-write-idlewatch-config/,
✖ AC2/AC5 — a real manager-start writes cold-start-checklist.md (7 keys) + idle-watch.env and still creates identity + loop-registry (336.300612ms)
  AssertionError [ERR_ASSERTION]: checklist must carry key IDLE-WATCH-MOUNTED
    actual: '# manager cold-start — observable consequences（falsifiable checklist）\n\n冷启动完成判据 = 下列 5 条可证伪项**全部为真**。\n一条为假 ⇒ manager 冷启动未完成。每键给出可检查判据与证据。\n\n| # | Key | 可检查判据 | 证据 |\n|---|---|---|---|\n| 1 | SESSION-CREATED | `tmux has-session -t <SESSION>` 且 pane 有 claude 进程（非裸 bash） | 启动时已建会话（manager-start.sh） |\n| 2 | HOME-CREATED | `<home>/identity` 存在，含 `role=manager` | 启动时已写（manager-start.sh） |\n| 3 | LOOP-ARMED | `manager-arm-loop.sh --home <home> --validate` 退出 0，且 `<home>/loop-registry.txt` 恰一条 `[manager-tick]` | 启动时已武装（manager-arm-loop.sh；失败时 manager-start 非零退出） |\n| 4 | CRON-EVIDENCED | `manager-arm-loop.sh --home <home> --verify-cron` 退出 0（注册表↔真 CronCreate/CronList 证据一致且新鲜） | 首 tick 填（manager-tick-core.md B4 记 `<home>/cron-evidence.jsonl`） |\n| 5 | CHECKLIST-REPORTED | 本文件五键全为 true 且各有证据 | 全部填完后为 true |\n\n启动态预期满足：#1 #2 #3（arm 失败时 manager-start 非零退出）。待首 tick：#4 #5。全 true 才可报 COMPLETE。\n',
    expected: /IDLE-WATCH-MOUNTED/,
✖ gap-idle-watch-intent-anchor-restore — --ensure-mount-intent writes the mount-intent anchor without tmux/arm/launch side effects (22.63419ms)
  AssertionError [ERR_ASSERTION]: --ensure-mount-intent must exit 0:
    actual: 2,
    expected: 0,
✖ plugin/test/oute
- run_id：wk-prod-1788285192
- session_id：f980bf4c-7460-4644-a994-9e4db5c627a1
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-retire-session-liveness-wk-prod-1788285192.log

## Needs-Human

**执行 2026-09-03T17:25:39.981Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=scoped-gate: ✔ REVERSE-EDGE AC4 (negative control): declared reverse-edge but the integration side FAILS the content criterion → FAIL-CLOSED (never blind-choose) (1022.059265ms)
✔ FRESHNESS GATE (scope axis legacy): an ABSENT scope field (pre-scope state) ⇒ treated as main ⇒ ALLOWED (fail-open legacy semantics) (753.162995ms)
✔ AC1 — no secrets checked in (deepseek key / anthropic token / sk- pattern) (1.318226ms)
✔ AC4 — deepseek roles reference the checked-in settings file; manager's effective env excludes 917k (via unset) (800.367577ms)
✔ adversarial — 0 test files resolved ⇒ fail-closed red, NEVER a whole-suite fallback (155.435326ms)
✔ usage — a bad --root fails with exit 2 (fail-closed on misuse, not a silent green) (16.799741ms)
✔ AC3 — cold-start-e2e.sh asserts the build-required files, fail-named (inner-state.sh retired, not required) (0.921564ms)
✔ AC4 — the launch-config trio is checked-in: claude-fjdac + deepseek-v4-pro-anthropic (profiles.yml) + CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000 (settings env) (1.6124ms)
✔ AC4 — the launch config 三件套 (deepseek-v4-pro-anthropic + CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000) is checked in (147.206265ms)
✔ AC2 — CLI: a transcript with a manager observation exits 1 and reports the violation (159.099896ms)
✔ AC2 — CLI: --report appends a JSONL record for a persistent violation log (144.336961ms)
✔ AC5b — tick-log check: fresh row PASS; skipped round (stale mtime) FAIL; no row FAIL (209.555513ms)
✖ AC3 — `quay manager adopt --dry-run` against a REAL outer window yields healthy (not missing) via outer-session-check.sh (1680.332175ms)
✔ manager-tick-readings: goalReading counts checked/total ACs in manager-phase-goal.md (1.81148ms)
✖ audit exit 1 + stale flags when a consumer cannot reach the registry (stale detection path) (472.923418ms)
✖ referencedScripts filters script basenames by presence in the tick-core text (4.881691ms)
✖ real repo is GREEN — orphan-checker N=0 (outer-anchor-check.ts explicitly retired) (3961.593266ms)
✔ state machine — fail-closed: no session config ⇒ exit 1 (never guess a session name) (37.928709ms)
✔ AC7: hash-regression negative control — a busy fixture relabeled as waiting-input must FAIL (the test asserts semantics, not that the code ran) (0.838786ms)
✔ AC2: the fault-6 criterion is mechanized in the pure verdict — C-u cleared ⇒ real; byte-identical ⇒ ghost; bounded + fail-loud (2.394482ms)
✔ AC2 — NO matching tmux session: fail-closed (exit 2), refuses to write, names --tmux-session; the monitor config is never written (283.79378ms)
✔ buildCommitTraceIndex: fail-closed on a non-git root (empty, never throws) (28.574054ms)
✔ no-AC-section fallback (AC4, AC47-corrected): present-but-boxless landed no-AC task is a done-flip; ABSENT AC section is fail-closed (75.476246ms)
✔ >50% checked but a remaining implementation box ⇒ NOT landed (stays in the dispatchable pool) (11.660797ms)
✔ AC all checked but DoD has unchecked IMPLEMENTATION boxes ⇒ NOT landed (cli-import shape, human ruling) (11.177807ms)
✔ priorityLevel maps p1/p2/none to ascending sort ranks (p1=1, p2=2, none=Infinity; unknown level fail-open) (0.879245ms)
✔ detectLandingBlocked is fail-safe on a non-git root (no false report, no throw) (21.316466ms)
✔ todo candidate with prose prereq and NO edge ⇒ ineligible for promotion (author→ready fail-closed) (111.452606ms)
✔ AC2: applyRevaluations writes ready→todo + a grep-able ## Revaluation body record; retreatReadyToTodo is fail-closed (150.710364ms)
✔ CLI measure: no matching evidence → stdout state: unknown, exit 3 (three-state contract — NOT a bare FAIL) (159.319681ms)
✔ CLI measure: missing transcript file → exit 2 (fail loud, never a silent false) (132.978296ms)
✔ AC4: a MISSING checker exits 1 at startup (fail-loud), never a silent broken delivery (gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure) (31.510151ms)
✔ AC3 fail-closed: a target whose window name != expected (default inner) is REJECTED before any send — nothing lands in the t
- run_id：wk-prod-1788285192
- session_id：e9a8c26e-a5d1-4755-b419-0142e8db39ee
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-retire-session-liveness-wk-prod-1788285192.log
