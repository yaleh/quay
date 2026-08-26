---
id: gap-quiet-window-holder-scope-wider-than-consumer
title: 退役 quiet-window 机制——它挡的是非瓶颈（ff churn 仅 34% 且收敛有界），真瓶颈是单飞锁排队（66%，归 lock-starvation）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**方向反转（人裁定 + manager 实测，推翻本任务先前「扩大覆盖」的 AC1）**：44 次 exited-not-landed 按 runId+时间窗精确匹配的真实构成——

- **真到 ff 并失败：15 次（34%）**；**根本没到 ff：29 次（66%）**——先前把整件事归给 ff churn 是错的，66% 卡在单飞锁排队（不是 ff）。
- **ff churn（34%）有界且收敛**：24h 内 fan-in-retries 34 条 / 18 任务 / 25 次执行，attempt 分布 1×23·2×6·3×3·4×1·5×1，同期落地 32 个 ⇒ **34 失败 vs 32 落地 ≈ 1:1（频率未超吞吐率）、18/25 次只失败一次、最多 5 次收敛**。人逐字：「要挡住的不是'谁在提交'，而是'suite 期间 develop 会前进'这件事本身，而那是不该挡的」。
- **⇒ 为 ff churn 加 quiet-window（无论覆盖多宽）是在给一个不是瓶颈的地方加阻塞**。先前本任务诊断的「holder 声明宽于消费者」是真实的，但它的正确处置不是「扩大覆盖」（那会让一个本不该挡的机制挡得更多），而是**退役整个 quiet-window**。
- **真瓶颈是单飞锁排队**（66%）：worker 派发 → fan-in → 等单飞锁 → 超过 worker 回合 → end_turn → exited-not-landed → 重派 → 重新排队 → 队列更长 → 更易超时，**自放大**（当场实测：5 任务中 4 个等锁 7-83 分钟、只 1 个在跑）。归 `gap-suite-lock-starvation-long-validation-hold`（delivery-critical）。

## Plan

退役 quiet-window：移除 holder 声明、`quietWindowActive` 消费（promotion-driver.ts:158/739）、ff-escalation 的 quiet-window 请求写。⛔ 与 lock-starvation 的修复独立、不重叠——退役 quiet-window 不得掩盖真瓶颈。

## Acceptance Criteria

- [x] AC1（能取假，quiet-window 退役）：quiet-window 机制全移除（holder 声明 + quietWindowActive 消费 + ff-escalation 请求写），`grep quietWindowActive` 零命中；（⛔ 残留 ⇒ 假）。**验证**：`grep -rn quietWindowActive`（全仓，含 packages/ 与 tests）零命中；holder 声明（`holder:"all-layers-except-fan-in-executor"`）、`quietWindowActive`/`parseEscalationRecords`/`ESCALATIONS_REL` 消费、ff-escalation 的 `quietWindow` 请求对象全部移除。
- [x] AC2（能取假，负控制 ff churn 不恶化）：退役后 ff churn 仍保持有界（24h 频率比 ≈1:1、attempt 收敛分布不恶化）；（⛔ 退役后 ff churn 爆炸 ⇒ 假）。**验证**：有界性机制不变——retry 计数（attempt 按 runId 计数）与 anti-livelock 停止（attempt≥3 → exit 3 `stop-retry`）保留，退役的只是「请求其他层 hold develop」的阻塞半边，非 churn 收敛半边。
- [x] AC3（能取假，不掩盖真瓶颈）：退役 quiet-window 后，66% 那类（单飞锁排队导致 exited-not-landed）的根因仍归 lock-starvation、不被 quiet-window 退役掩盖或更糟；（⛔ 被掩盖 ⇒ 假）。**验证**：escalation-resolution 信号保留（`quiet-window-resolved` → `ff-escalation-resolved` 更名，非删除），slot-refill 的 `computeUnresolvedEscalationTaskIds` 读「最新 event ≠ ff-escalation ⇒ resolved」语义不变 ⇒ lock-starvation 检测未被掩盖，66% 根因仍由 `gap-suite-lock-starvation-long-validation-hold` 承接。

## Definition of Done

quiet-window 机制退役；AC1-AC3 全勾；ff churn 仍收敛有界；66% 的锁排队根因由 lock-starvation 任务承接。

## Touches

- plugin/scripts/promotion-driver.ts（quietWindowActive 定义/消费移除 + holder 声明移除）
- plugin/scripts/fan-in-ff-merge.sh（ff-escalation quiet-window 请求写移除 + escalation-resolution 记录更名）
- plugin/scripts/fan-in-workflow-check.ts（Escalation 类型 quietWindow 字段移除 + 注释更名）
- plugin/scripts/slot-refill.ts（escalation-resolution 注释更名）
- plugin/test/promotion-driver.test.mjs（quiet-window 消费测试移除）
- plugin/test/fan-in-ff-merge.test.mjs（escalation/resolution 断言更新）
- plugin/test/fan-in-workflow-check.test.mjs（escalation 断言更新）
- plugin/test/slot-refill.test.mjs（resolution fixture 更名）
- tasks/gap-quiet-window-holder-scope-wider-than-consumer.md（自身）
