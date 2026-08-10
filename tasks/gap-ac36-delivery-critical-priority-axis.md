---
id: gap-ac36-delivery-critical-priority-axis
title: 'slot-refill.ts candidates.sort(:264) 加第二轴 label:delivery-critical——优先级低于 blocking_suite、高于 id 序；打了该 label 的任务在 recommended 里位次严格前移（负控制：不打 label 位次不变）；端到端：下一条本阶段 AC 任务打 label 后 inner 派发即取'
status: todo
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

**`slot-refill.ts:264` 的排序只有一个轴——`blocking_suite`（谁挡住 suite 谁优先），且 `:329` 明写「SIGNAL, not a gate」（只重排、不成闸）。没有任何轴表达「这条任务在交付关键路径上」。实证：`gap-load-sensitive-serial-phase-unbounded-growth-measure-first`（`ready`、AC 0/11、立案 00:18）9 小时未被取，而同期 22 条别的任务完成 fan-in。⇒ 现在建交付任务，会和池里 30 条一起排队，被 `blocking_suite` 轴压在后面。**

**这是本阶段（2026-08-10 人裁定：暂停三层统一架构、转产品化交付）的优先级机制。** 人指定顺序：先做 AC36（优先级第二轴），再用该轴推进 AC37-AC40 与 AC16③。

### 实证（manager 2026-08-10 09:2x + outer 复核）

- **唯一轴**：`slot-refill.ts:267-273` 的 `candidates.sort`——`suiteBlockingIds.has(a.id) ? 0 : 1`，其余 `a.id.localeCompare(b.id)`。没有「交付关键路径」的维度。
- **代价实测**：`gap-load-sensitive-serial-phase-unbounded-growth-measure-first` ready/AC 0-11/立案 00:18，**9 小时未被取**，同期 22 条别的任务 fan-in。
- **通道背景（人指定）**：存在一条「outer 直接发消息给 inner 要求排入某任务」的通道（不太可靠但存在）。本任务正是用它把「可靠通道」本身做出来——AC36 实现后，打 `delivery-critical` label 的任务经常规池排队即可前移，不再需要那条脆弱通道。

### 判定（三条，全部机械可核）

1. **排序加第二轴**：`slot-refill.ts` 的 `candidates.sort`（复用已有位置，不新建调度器）加第二轴 `label:delivery-critical`——优先级低于 `blocking_suite`、高于 id 序。即排序键从 `(blocking_suite, id)` 变为 `(blocking_suite, delivery_critical, id)`。
2. **位次严格前移**：打了 `delivery-critical` label 的任务，在 `--json` 的 `recommended` 里**位次严格前移**；**负控制：不打 label 的同族任务位次不变**（id 序保持）。
3. **端到端**：给本阶段任一 AC 的实现任务打上 `delivery-critical` 后，**下一次 inner 派发即取它**（时间戳可核——取该任务的 dispatch 时间戳 > 打 label 时间戳）。

**实现要点**：`parseCandidate`（concurrent-batch-scheduler.ts:68）当前不暴露 labels——需要从任务体读出 frontmatter `labels` 含 `delivery-critical`（同文件已有 `parseTask` 从 task-schema.ts 读 labels 的先例，slot-refill.ts:250 已用）。排序键第三位 = 该 candidate 是否 `delivery-critical`。

**验证锚**：修后 (a) `--json` 的 `recommended` 里 delivery-critical 任务位次前移（打 label 前后对比）；(b) 负控制：同族不打 label 任务位次不变；(c) 端到端：下一条打 label 的本阶段 AC 任务被 inner 首次派发取走（时间戳可核）。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录唯一轴实证（slot-refill :267-273 只按 blocking_suite + id 序；gap-load-sensitive 9h 未取 vs 22 条 fan-in）（本任务 Proposal 已含）
- [ ] AC2: **第二轴落地**——`candidates.sort` 加 `label:delivery-critical`（优先级低于 blocking_suite、高于 id 序），复用已有位置不新建调度器
- [ ] AC3: **位次严格前移**——打 label 任务在 `--json` recommended 里位次前移；**负控制**：不打 label 的同族位次不变
- [ ] AC4: **端到端**——给本阶段任一 AC 实现任务打 label 后，下一次 inner 派发即取它（dispatch 时间戳 > 打 label 时间戳，可核）
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿（含 slot-refill.test.mjs / ready-pool-check 相关）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：打 label 前后 recommended 位次对比（贴输出）；负控制位次不变；端到端 dispatch 时间戳
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/slot-refill.ts（AC2：candidates.sort 加第二轴）
- plugin/scripts/concurrent-batch-scheduler.ts（AC2：parseCandidate 暴露 labels / delivery-critical 标志）
- plugin/scripts/task-schema.ts（AC2：若 parseTask 已读 labels 则复用；否则补）
- plugin/test/slot-refill.test.mjs（AC3/AC4：位次前移 + 负控制 + 端到端）
- plugin/test/concurrent-batch-scheduler.test.mjs（AC2：parseCandidate labels 解析）
- orchestration/manager-phase-goal.md（AC36 判据正本——本任务 Proposal 已引用）
- tasks/gap-ac36-delivery-critical-priority-axis.md（自身：勾 AC + 贴证据）

## Contract

measure   delivery_critical_rank = `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root "$PWD" --cap 5 --json` 的 stdout 中 recommended 里 delivery-critical 任务的下标（打 label 前 vs 后）
band      delivery_critical_rank_improved = 打 label 后下标 < 打 label 前下标（严格前移）；负控制：不打 label 同族下标不变
invariant delivery_critical_below_suite_blocking = 1（blocking_suite 仍最优先）
invariant id_order_preserved_within_tie = 1（同轴内 id 序保持）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root "$PWD" --cap 5 --json`（贴 recommended 数组 + delivery-critical 下标）
control   打 label 前移；负控制不变；blocking_suite 不降；id 序保持
resume    第二轴 / 位次验证 / 端到端分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: 本阶段（产品化交付）第一件工作（manager 指定顺序+通道）。AC36 = slot-refill 第二轴 label:delivery-critical（低于 blocking_suite、高于 id 序）。实证 gap-load-sensitive 9h 未取。驱动通道 = outer 直接发消息给 inner 排入（非常规池排队）。实现归 inner，判定归 outer。本任务自带 delivery-critical label——实现后即用新轴推进 AC37-40 与 AC16③
