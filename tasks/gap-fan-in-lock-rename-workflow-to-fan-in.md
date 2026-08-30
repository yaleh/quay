---
id: gap-fan-in-lock-rename-workflow-to-fan-in
title: fan-in 串行化锁改名——「workflow 锁」→「fan-in 锁」（纯语义，非关键路径，机械 fan-in 首绿后落地）
status: done
labels:
  - gap
  - refactor
parent: null
children: []
extra:
  schema: execution
  defer: post-mechanical-first-green
---
**type:** execution

## Proposal

机械 fan-in 与 fan-in-execute workflow 用同一把锁（已取证）：
- `worker-driver.ts:1632` 与 `fan-in-execute.js:559`（plugin/.claude 双副本）都调 `fan-in-ff-merge.sh --acquire-workflow-lock`；
- 锁文件 `${git_common_dir}/fan-in-workflow.lock`，事件同写 `.quay/fan-in-workflow-lock-events.jsonl`（机械 `wk-prod-*` 与 workflow `runId` 混同一文件）。

锁保护的是「fan-in 落地操作」（谁可 merge develop），主消费者已是机械 driver，workflow 退役为兜底——按次要消费者命名**误导且与操作语义不符**。单锁共享是正确设计（拆分会导致并发落地竞态），故只改名，不改结构。

**⛔ 非关键路径**：不加 `delivery-critical`，**在机械 fan-in 首绿后落地**（`extra.defer` 已标），不与关键路径（force-color/silence-watchdog/version-mismatch）争派发。

**⛔ 时序（2026-08-28 补）**：锁改名须排在 `gap-adr034-fan-in-lock-holder-supervised`（ADR-034，P1，重设计 acquire/释放路径）落地**之后**——两任务改同一文件（fan-in-ff-merge.sh / worker-driver.ts），先改名后改机制会双重复用冲突；且 Plan#3 改的双副本 fan-in-execute.js 须在 SPEC P3（`gap-execution-loop-productization-p2-p4`，删除双副本）之前完成。

## Plan

1. 标识符全量改名（锁名/flag/文件路径/事件文件/tmp 组/注释日志），⛔ 不做一半。
2. checker 三件套改读新事件文件路径。
3. 双副本 fan-in-execute.js 同步改（字节一致，改单边会被 workflows-dual-copy-drift-check 拦）。

## Acceptance Criteria

- [x] AC1（能取假，锁名已改）：`fan-in-ff-merge.sh --help` 无 `workflow` 字样（⛔ 仍含 workflow ⇒ 假）。
- [x] AC2（能取假，checker 读新路径绿）：三个 checker 读新事件文件路径且绿（⛔ 读旧路径/红 ⇒ 假）。
- [x] AC3（能取假，双副本一致）：plugin/.claude 两 fan-in-execute.js 字节一致（⛔ 不一致 ⇒ 假）。
- [x] AC4（能取假，两路径同锁）：机械 + workflow 兜底两路径仍能 acquire 同一 `fan-in.lock`（⛔ 拆成两锁/竞态 ⇒ 假）。

## Definition of Done

锁名/flag/文件路径/事件文件/tmp 组全量改名；checker/测试同步；双副本字节一致；机械+兜底两路径仍共享同一 fan-in.lock；机械 fan-in 首绿后落地。

## Touches

- plugin/scripts/fan-in-ff-merge.sh（--acquire/--release-workflow-lock → --acquire/--release-fan-in-lock；锁文件 fan-in-workflow.lock → fan-in.lock；事件文件 .quay/fan-in-workflow-lock-events.jsonl → .quay/fan-in-lock-events.jsonl；/tmp/fan-in-workflow-lock-* 组同步）
- plugin/scripts/worker-driver.ts（acquire/release 调用 + 事件文件路径常量 + readLockMetricsForRun 读取路径）
- plugin/workflows/fan-in-execute.js（双副本之一，改后与 .claude 副本字节一致）
- .claude/workflows/fan-in-execute.js（双副本之二）
- plugin/scripts/fan-in-ff-protocol-check.ts（checker 改读新事件路径）
- plugin/scripts/fan-in-workflow-check.ts（checker 改读新事件路径）
- plugin/scripts/fan-in-ff-executor-check.ts（checker 改读新事件路径）
- plugin/test/fan-in-workflow-lock.test.mjs（锁文件名/flag 断言）
- plugin/test/fan-in-driver-mechanical-orchestration.test.mjs（机械 acquire 新锁名）
- plugin/test/fan-in-ff-protocol-check.test.mjs（checker 新路径）
- plugin/test/worker-driver.test.mjs（import/调用 acquireFanInLock + fanInLockFile 同步改名）
- plugin/test/resource-gate.test.mjs（注释：fan-in lock prose）
- plugin/test/fan-in-execute-paths.test.mjs（注释：step 0.5 获取 fan-in 锁 prose）
- plugin/scripts/suite-slot-lib.sh（注释：timer-cut=0 的 fan-in lock prose）
- .gitignore（事件文件 + token flag 组路径改名）
- tasks/gap-fan-in-lock-rename-workflow-to-fan-in.md（自身）
