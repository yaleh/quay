---
id: gap-fan-in-workflow-lock-and-S1
title: fan-in workflow 锁 + S=1——锁住 merge 阶段消除 ff-race 整份作废（SPEC 正本 orchestration/SPEC-fan-in-workflow-lock-and-S1-2026-08-26.md）
status: ready
labels:
  - gap
  - feature
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-suite-concurrency-S-two-source-divergence
    - gap-suite-serial-lowconc-classification-recheck
---
**type:** execution

> **正本**：`orchestration/SPEC-fan-in-workflow-lock-and-S1-2026-08-26.md`（人 2026-08-26 18:5xZ 提方案逐字在 §0.1，manager 五点约束 §3）。**⛔ 边界（SPEC §6）**：不改 detach-develop 的 ref 更新方向（正交）；不删语义 subagent 的 suite-red/infra-hang 分类；不设锁持有超时数值阈值（成本结构未测量前不设，硬规则 4 推论）。

## Proposal

把 fan-in 的「merge 锁」从毫秒级 `git merge --ff-only` 扩大到「整个 fan-in workflow（merge develop → 全量 suite → ff）」，使 develop 在有锁任务 fan-in 期间**不前进**、ff 结构上不输；suite 单飞锁 S 改 1（fan-in 锁已串行化 fan-in 内的 suite）；两把锁都挂 driver 看门狗。

**⊢ 为什么（24h 实测，SPEC §1.2，非推演）**：52 suite / 28 任务，suite 真红 **0 次**（52 全绿），ff-race **27 次**（96.4% 任务撞上），46% 次数 / 62% 墙钟纯由 ff-race 整份作废。现有 `--classify-delta` inert 分类只救 doc 增量，**救不了 code 增量**（27 次全是 code）。fan-in 锁让 code 增量在 fan-in 期间也不发生 ⇒ ff-race 结构上归零。

**⊢ 核心权衡（SPEC §2.3）**：确定性 vs 吞吐——S=1 + fan-in 锁墙钟 28×时长 vs 现状 S=2 的 26×时长（**慢 7.7%**），但消掉「8 次 suite 全绿却 ff 输 7 次 → needs-human」的尾部风险（24h 已 2 个 needs-human：load-sampler + ac143）+ 46% CPU 浪费。**本 SPEC 不是更快，是更确定 + 少烧 CPU**——与「定义正确机制不修补」同向（fan-in 锁让 ff-race 结构上不可能，语义 subagent 的 rebase-and-retry 是分类后补救）。

## Plan

1. fan-in 锁落地：从 merge develop 到 ff 完成的整个 workflow 持锁；持锁期间其它任务不得 merge develop。
2. suite 锁 S 改 1，经 `.concurrency` 文件单一来源（先修两源分叉）。
3. SPEC §3 五约束逐条落地（确定性确认 / 修订 AC4 / 固定锁序 / 看门狗挂 driver / 裁决语义 subagent ff-race-loss）。

## Acceptance Criteria

- [ ] AC1（能取假，fan-in 锁覆盖整个 workflow）：fan-in 锁从 merge develop 覆盖到 ff 完成（含全量 suite），持锁期间其它任务不得 merge develop；负控制：持锁期间第二任务 merge develop 被拒（⛔ 仍只在 ff 毫秒级持锁 ⇒ 假）。
- [ ] AC2（能取假，S=1 经单一来源）：suite 锁 S 改 1，经 `.concurrency` 文件单一来源（先修两源分叉）；（⛔ S 仍 2 或两处读不同来源 ⇒ 假）。
- [ ] AC3（能取假，修订 AC4）：显式修订 `SPEC-fan-in-ff-merge-lock-2026-08-14` 的 AC4（fan-in 锁允许 overlap suite run），`fan-in-ff-protocol-check.ts` 不恒红；（⛔ AC4 未修订 ⇒ 协议检查器恒红 ⇒ 假）。
- [ ] AC4（能取假，固定锁序消除死锁）：规定「先 fan-in 锁 → 再 suite 锁」固定顺序、任何路径不得反向、fan-in 外 suite 测试不得请求 fan-in 锁；负控制：反向获取顺序被检测/拒；（⛔ 无序 ⇒ 死锁 ⇒ 假）。
- [ ] AC5（能取假，看门狗挂 driver）：fan-in 锁看门狗复用 suite 锁模式（`FULL_SUITE_LOCK_HOLD_MAX_S` + watchdog），挂 driver respawn 下；持锁者崩溃 ⇒ 看门狗释放锁；（⛔ 无看门狗 ⇒ 锁泄漏 ⇒ 假）。
- [ ] AC6（能取假，二选一裁决）：明确裁决语义 subagent 的 `ff-race-loss` class 去留（砍/降级），suite-red/infra-hang 分类保留；（⛔ 两机制叠加 ⇒ 为 0 发生率 class 保留恢复路径 ⇒ 假）。

## Definition of Done

fan-in 锁 + S=1 落地；AC1-AC6 全勾；ff-race 结构上归零（不再整份作废）；SPEC §3 五约束逐条兑现。

## Touches

- plugin/scripts/fan-in-ff-merge.sh（fan-in 锁粒度从毫秒级扩大到整个 workflow）
- .claude/workflows/fan-in-execute.js（merge develop → suite → ff 全段持锁，双副本）
- plugin/workflows/fan-in-execute.js（merge develop → suite → ff 全段持锁，双副本同步）
- plugin/scripts/suite-slot-lib.sh（S=1 经单一来源）
- scripts/test.sh（S=1 经单一来源）
- plugin/scripts/fan-in-ff-protocol-check.ts（修订 AC4）
- plugin/test/（fan-in 锁 + S=1 + 锁序 + 看门狗负控制）
- tasks/gap-fan-in-workflow-lock-and-S1.md（自身）
