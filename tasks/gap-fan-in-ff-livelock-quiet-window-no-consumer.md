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
extra: {}
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

- [ ] AC1（能取假，落地不再活锁）：develop 高写入速率下，fan-in 仍能落地（不依赖 20min 零提交窗口）；（⛔ 仍卡 diverging-branches 活锁 ⇒ 假）。
- [ ] AC2（能取假，quiet-window 有消费者）：request-quiet-window 请求有真消费者（窗口期 develop 写入被暂停，或 fan-in 改 rebase 不依赖窗口）；（⛔ 请求仍无消费者 ⇒ 假）。

## Definition of Done

fan-in ff 活锁消除；AC1-2 全勾；quiet-window 请求有消费者（或 fan-in 改 rebase-retry 不依赖窗口）；`gap-ff-livelock-trigger-no-action` 的「done」名副其实（或补上兑现半边）。

## Touches

- plugin/scripts/fan-in-ff-merge.sh（改 rebase-retry 或接 quiet-window 消费者）
- plugin/scripts/promotion-driver.ts（窗口期暂停 develop 写入，如选①）
- plugin/scripts/fan-in-workflow-check.ts（检查器，如需读 quiet-window 兑现）
- plugin/test/fan-in-workflow-check.test.mjs（对应测试）
- tasks/gap-fan-in-ff-livelock-quiet-window-no-consumer.md（自身）