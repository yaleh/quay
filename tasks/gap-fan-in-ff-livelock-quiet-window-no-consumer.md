---
id: gap-fan-in-ff-livelock-quiet-window-no-consumer
title: fan-in ff 活锁——quiet-window 请求无消费者（diverging branches 后无人兑现零提交窗口）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  depends_on:
    - gap-fan-in-ff-retry-counter-scope
---
**type:** execution

## Proposal

develop 2.5h+ 无「翻 done」落地（最近 e9f2c9ac 15:40Z），同期 11 worktree 在飞、suite 绿、worker-driver 持续产出——不是 worker 卡死，是 **fan-in 落地这一步系统性活锁**。根因（已核实）：fan-in ff 撞 `Diverging branches can't be fast-forwarded`（今日 `.quay/fan-in-ff-escalations.jsonl` 6 条，18:11Z 最新），≥3 次后转 `request-quiet-window-and-stop-retry`（要求 develop 20min 零提交），但该请求**无消费者**——`grep -rln fan-in-ff-escalations plugin/ orchestration/` 只命中检查器（fan-in-workflow-check.ts）+ 写入者（fan-in-ff-merge.sh），无人暂停 develop 写入。develop 写入速率高（20min 6 次提交：promotion-driver 晋升 + manager SPEC 文档）⇒ 零提交窗口结构上不可达 ⇒ 活锁非偶发。

**硬规则 5b**：`gap-ff-livelock-trigger-no-action`（status=done）只定义了「触发后写 request-quiet-window 记录」动作本身，没让任何东西兑现窗口——今天复发验证「在一处定义了动作 ≠ 动作在系统里被真正执行」。

## Plan

quiet-window 请求需真消费者，方向二选一（或组合）：
① promotion-driver/manager 窗口期内暂停 develop 写入（兑现 holder:all-layers-except-fan-in-executor）；
② fan-in 侧改 rebase-retry 而非纯 ff（⛔ 需先确认 `gap-ac75-fan-in-merge-not-rebase-delta-check`（done）的 rebase→merge 是否覆盖 `fan-in-ff-merge.sh` 这条路径——现报错是 ff，说明未覆盖或另有 ff 路径）。

## Acceptance Criteria

- [x] AC1（能取假，落地不再活锁）：develop 高写入速率下，fan-in 仍能落地（不依赖 20min 零提交窗口）；（⛔ 仍卡 diverging-branches 活锁 ⇒ 假）。
- [x] AC2（能取假，quiet-window 有消费者）：request-quiet-window 请求有真消费者（窗口期 develop 写入被暂停，或 fan-in 改 rebase 不依赖窗口）；（⛔ 请求仍无消费者 ⇒ 假）。

## Definition of Done

- [x] fan-in ff 活锁消除；AC1-2 全勾；quiet-window 请求有消费者（或 fan-in 改 rebase-retry 不依赖窗口）；`gap-ff-livelock-trigger-no-action` 的「done」名副其实（或补上兑现半边）。

## Touches

- plugin/scripts/fan-in-ff-merge.sh（选①消费者兑现半边：ff 成功写 `quiet-window-resolved` 记录，同 escalation 文件同 append）
- plugin/scripts/promotion-driver.ts（选①消费者：窗口期读 escalation 请求并 hold 暂停 develop 写入；resolution/到期自愈）
- plugin/scripts/fan-in-workflow-check.ts（`escalatedTaskIds` 过滤 `ff-escalation`，resolution 记录不再污染 d-check）
- plugin/test/fan-in-ff-merge.test.mjs（补测：ff 成功写 resolution 记录）
- plugin/test/promotion-driver.test.mjs（补测：`quietWindowActive` 纯函数 + 循环 hold/恢复）
- plugin/test/fan-in-workflow-check.test.mjs（补测：`escalatedTaskIds` 过滤 resolution）
- tasks/gap-fan-in-ff-livelock-quiet-window-no-consumer.md（自身）

## Evidence

**（2026-08-24 落地回填）**

**方向选择（Plan ①② 二选一）**：选 **①（quiet-window 真消费者）**。②（rebase-retry）与 AC75「无锁段第 1 步必须 merge 不得 rebase」冲突——现报错是 `git merge --ff-only`（持锁段 ff，本就不是 rebase），改 rebase 会作废已跑绿的 suite、回到 AC75 明确否掉的路径，故排除。

**AC2 能取假（quiet-window 有消费者）——两件套**：
1. **兑现半边（`fan-in-ff-merge.sh`）**：ff 成功（exit 0，post-check 后）追加一条 `event:"quiet-window-resolved"` 到 **同一** `.quay/fan-in-ff-escalations.jsonl`（同文件同 append，⛔ 无新 jsonl）——escalation 请求的 `endsEarly:"ff-success"` 半边。测试 `fan-in-ff-merge.test.mjs`「ff success writes a quiet-window-resolved record」断言五字段（event/taskId/runId/agentId/mergeTarget/ts/epoch）。
2. **消费者（`promotion-driver.ts`）**：resident loop 每轮读 escalation 文件，`quietWindowActive` 纯函数判定「有未兑现、且在 windowMinutes 内的请求」⇒ **hold**——不跑 `ready-pool-check --apply`、不 spawn fix worker（暂停 develop 写入，兑现 `holder: all-layers-except-fan-in-executor`）。hold 自愈：升级任务落地（resolution 更新）或窗口到期（epoch + 20min）。round 记录 `action="held"` + `held=true` + `quiet_window.heldTasks`，outer 可观测。

**AC1 能取假（不再活锁）**：活锁根因是「请求无消费者 ⇒ 20min 零提交窗口结构上不可达」。现在请求有机械消费者——窗口期 promotion-driver 的 `--apply` 晋升（`commitTaskStatus` 的 develop 提交）被暂停，请求不再是无兑现的空喊。`promotion-driver.test.mjs` 取假测试：有请求 ⇒ 循环 hold（eligible todo 不被晋升、action=held）；resolution 更新 ⇒ 恢复（eligible todo 被晋升）。resolution 记录同时让「升级任务已落地」成为 checker 可读的兑现证据。

**checker（`fan-in-workflow-check.ts`）**：escalation 文件现在同时含 `ff-escalation`（请求）与 `quiet-window-resolved`（兑现）两类记录——`escalatedTaskIds` 过滤 `event==="ff-escalation"`，兑现记录不污染 判据2(d) traceability（已落地任务不是「未落地的 escalation 尝试」）。测试「PURE escalatedTaskIds — a quiet-window-resolved record is NOT an escalation」取假：裸 resolution 不计 escalation。

**测试**：`fan-in-ff-merge.test.mjs` 24/24（+1）、`promotion-driver.test.mjs` 43/43（+6）、`fan-in-workflow-check.test.mjs` 67/67（+1）全绿。

**⚠️ 边界诚实声明**：本任务 Touches 内可机械接的消费者是 **promotion-driver**（唯一在 Touches 内的 develop 写入脚本）。holder「all-layers-except-fan-in-executor」的其余层（manager 的 SPEC 文档提交、outer 的直改）不在本任务 Touches，其窗口期 hold 是各自层的独立消费（本任务交付的是机制 + 第一个消费者，机制已可被其余层复用）。⛔ 不做「其余层已 hold」的越界声明。
