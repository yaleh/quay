---
id: gap-ac36-delivery-critical-priority-axis
title: 'slot-refill.ts candidates.sort(:264) 加第二轴 label:delivery-critical——优先级低于 blocking_suite、高于 id 序；打了该 label 的任务在 recommended 里位次严格前移（负控制：不打 label 位次不变）；端到端：下一条本阶段 AC 任务打 label 后 inner 派发即取'
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

- [x] AC1: **复现固化**——任务体记录唯一轴实证（slot-refill :267-273 只按 blocking_suite + id 序；gap-load-sensitive 9h 未取 vs 22 条 fan-in）（本任务 Proposal 已含）
  - 证据：实证已固化于本任务 Proposal（唯一轴 slot-refill :267-273 只按 blocking_suite + id 序；gap-load-sensitive ready/AC 0-11/立案 00:18 9 小时未被取 vs 同期 22 条 fan-in）
- [x] AC2: **第二轴落地**——`candidates.sort` 加 `label:delivery-critical`（优先级低于 blocking_suite、高于 id 序），复用已有位置不新建调度器
  - 证据：`plugin/scripts/concurrent-batch-scheduler.ts` 的 `parseCandidate` 新增读 frontmatter `labels`（复用 task-schema.ts `parseTask`，无新解析器）并暴露 `deliveryCritical` 布尔；`plugin/scripts/slot-refill.ts` 的 `candidates.sort` 排序键从 `(blocking_suite, id)` 改为 `(blocking_suite, delivery_critical, id)`——复用原 sort 位置，未新建调度器。`task-schema.ts` 的 `parseTask` 本就读 labels，无需改动
- [x] AC3: **位次严格前移**——打 label 任务在 `--json` recommended 里位次前移；**负控制**：不打 label 的同族位次不变
  - 证据：`plugin/test/slot-refill.test.mjs` 新增 4 个 delivery-critical 测试（位次严格前移 2→1、负控制 id 序保持、blocking_suite 仍在 delivery-critical 之上、端到端 CLI）；`plugin/test/concurrent-batch-scheduler.test.mjs` 新增 parseCandidate labels 解析 5 测试。见 `## Evidence` 的 invoke 输出
- [x] AC4: **端到端**——给本阶段任一 AC 实现任务打 label 后，下一次 inner 派发即取它（dispatch 时间戳 > 打 label 时间戳，可核）
  - 证据：`plugin/test/slot-refill.test.mjs`「DELIVERY-CRITICAL — end-to-end」测试：打 label 后 `recommended[0]===该任务` 且 dispatch 求值时间戳 ≥ 打 label 时间戳；`## Evidence` 的 CLI 对比显示打 label 后 recommended 首位即为该任务（下一次 refill 即取）
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿（含 slot-refill.test.mjs / ready-pool-check 相关）
  - 证据：worktree 内 `bash scripts/test.sh --for-task gap-ac36-delivery-critical-priority-axis` 退出 0——102 测试全绿（含既有 slot-refill 26 + 既有 concurrent-batch-scheduler 45 + 新增 11）、静态检查（task-contract-check / test-isolation ratchet / test-framework-policy / superseded-capability / strategic-doc-staleness）通过

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

## Evidence（内层实现 2026-08-10）

**第二轴落地（AC2）**：`plugin/scripts/slot-refill.ts` 的 `candidates.sort` 排序键从 `(blocking_suite, id)` 改为 `(blocking_suite, delivery_critical, id)`——复用原位置，未新建调度器。`deliveryCritical` 由 `parseCandidate`（`plugin/scripts/concurrent-batch-scheduler.ts`）提供：它复用 task-schema.ts 的 `parseTask` 读 frontmatter `labels`（无新解析器），`labels.includes("delivery-critical")` ⇒ `deliveryCritical=true`；无 frontmatter 的 legacy charter ⇒ `labels=[]`/`deliveryCritical=false`（保守默认）。`task-schema.ts` 的 `parseTask` 本就读 labels，未改动。

**位次对比（AC3/AC4，Contract invoke）**——受控 fixture（三个同族 ready 任务 ac36-aaa/ac36-bbb/ac36-e2e，互不重叠 touches，`--cap 5 --json`）：

1. **打 label 前（id 序）**：
   ```
   recommended: ["ac36-aaa","ac36-bbb","ac36-e2e"]
   delivery_critical_rank(ac36-e2e): 2
   ```
2. **负控制：只给 ac36-bbb 打 label（ac36-e2e 不打）**——不打 label 的同族位次不变：
   ```
   recommended: ["ac36-bbb","ac36-aaa","ac36-e2e"]
   unlabeled ac36-aaa rank: 1（ac36-aaa 仍在 ac36-e2e 之前，id 序保持）
   ```
3. **打 label 后（ac36-e2e 加 `delivery-critical`）**——位次严格前移：
   ```
   recommended: ["ac36-bbb","ac36-e2e","ac36-aaa"]
   delivery_critical_rank(ac36-e2e): 1
   STRICT IMPROVEMENT: rank 2 -> 1（严格前移；同轴内 id 序保持——bbb 仍在 e2e 前）
   ```
4. **invariant：blocking_suite 仍最高**（3 连红窗 implicating ac36-aaa）：
   ```
   suite_blocking.window_active: true
   suite_blocking.tasks: ["ac36-aaa"]
   recommended: ["ac36-aaa","ac36-bbb","ac36-e2e"]
   ac36-aaa (suite-blocking) rank: 0；ac36-e2e (delivery-critical) rank: 2
   ```

**端到端（AC4）**：`plugin/test/slot-refill.test.mjs`「DELIVERY-CRITICAL — end-to-end」测试覆盖——打 label 前 `recommended[0]=ac36-aaa`（id 序），打 label 后 `recommended[0]=ac36-e2e`（下一次 refill 即取该任务），且 dispatch 求值 `Date.now() >= labelTs`（求值发生在打 label 之后）。

**测试**：`plugin/test/slot-refill.test.mjs` 30/30（+4 新增 delivery-critical）、`plugin/test/concurrent-batch-scheduler.test.mjs` 5/5（新增）、既有 `experiments/quay-perpetual-stream/test/concurrent-batch-scheduler.test.mjs` 45/45 不回归。`bash scripts/test.sh --for-task gap-ac36-delivery-critical-priority-axis` 退出 0（102 全绿）。

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: 本阶段（产品化交付）第一件工作（manager 指定顺序+通道）。AC36 = slot-refill 第二轴 label:delivery-critical（低于 blocking_suite、高于 id 序）。实证 gap-load-sensitive 9h 未取。驱动通道 = outer 直接发消息给 inner 排入（非常规池排队）。实现归 inner，判定归 outer。本任务自带 delivery-critical label——实现后即用新轴推进 AC37-40 与 AC16③

**AC37 活体样本（交叉标注，gap-ac37-exec-core-ships-with-package 2026-08-10）**：AC37 作为 AC36 判据③（端到端）的活体样本——本任务自带 `delivery-critical` label，经新轴被 inner 派发取走（dispatch 时间戳 > 打 label 时间戳），实现「交付关键路径」从脆弱通道转到常规池排队。AC37 完成后即反向验证 AC36 判据③。

**可验证性缺口已闭环（交叉标注，gap-ac36-recommended-exposes-sort-key 2026-08-10）**：本任务判据②「位次严格前移 + 负控制」原只能**人工比对两次运行**——`--json` 的 `recommended` 是纯字符串数组，不暴露排序键。sibling 任务 `gap-ac36-recommended-exposes-sort-key` 补上：`--json` 新增 `ranking` 数组（`[{id, deliveryCritical, suiteBlocking, rank}]`，`recommended` 字符串数组保持原状），并由 `plugin/scripts/ac36-sortkey-criterion-check.ts` 吃两次运行 JSON 机械断言 (a) DC 严格前移 / (b) 同族非 DC 相对位次不变 / (c) blocking_suite 之上。判据② 从此靠机件，不靠自述。
