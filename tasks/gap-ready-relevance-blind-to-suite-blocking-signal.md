---
id: gap-ready-relevance-blind-to-suite-blocking-signal
title: ready_relevance/computeRelevance 的 blocking 只读任务间静态依赖，不读
  verification-round.jsonl 的连续红窗——一个红 5 轮的 suite 阻断缺陷 value 仍 0.25、排第 7，inner
  永远排不到前面挑中它；与 A14 背离度同族：真实持续可测信号没进任何判据
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`ready-pool-check.ts` 的 `computeRelevance`/`ready_relevance` 价值排序机制对「当前正在阻塞 suite」这一信号完全盲目——一个连续 5 轮把全量套件红在 red-window-shared-gate AC3 上的阻断缺陷（`gap-suite-state-trigger-crash-watchdog-breaks-running-transition-test`），`blocking` 字段仍是 `false`、`value=0.25`、排第 7，inner 的 slot-refill 永远不会挑中它。**

### 实证（manager 2026-08-09 核实 + outer 复核）

- **连续 5 轮红同一缺陷**：round-192(18:39)/193(18:53)/195(19:02)/196(19:13) 全部 `red/failed` 于 `gap-suite-state-trigger-crash-watchdog-breaks-running-transition-test`（round-194 aborted）。~55 分钟 suite 无法绿。
- **任务自身 status:ready、可派发**：`ready_relevance` 排 **第 7**，`value=0.25`、**`blocking: False`**、`cost=4`。
- **slot-refill recommended 5 条不含它**（推 inbox-counter/inventory-drift/measure-trend 等）。
- **根因**：`computeRelevance` 的 `blocking` 字段问的是**任务间的静态依赖关系**（这个任务是否被别的任务依赖/阻挡），不是「这个缺陷此刻正在把 suite 阻塞在红」。它**不读 `verification-round.jsonl` 的连续红窗信号**——一个阻塞近 1 小时、5 轮红的缺陷，价值排序仍给 0.25、排第 7，永远排不到前面被 inner 挑中。
- **与今晚立的 A14（背离度）同族**：一个真实、持续、可测量的信号（连续红窗），没有进任何判据。

**为什么重要**：这是「能测但决策不看」的又一实例——`verification-round.jsonl` 记录了每轮的 red + 失败原因，但 `computeRelevance` 不消费它。suite 阻塞型缺陷依赖人工发现 + 手动升级（本轮就是 manager 核实 + 我盯），机制本身不反映优先级。修复后，一个红了 N 轮的缺陷自动跃升到可派发前列，不需要人盯着。

### 选定机制方向（实现归内层，接法留执行时）

1. **blocking 动态置真**：`computeRelevance` 或 `ready_relevance` 排序增加一条——读 `verification-round.jsonl` 最近 N 轮（如 3 轮）连续 `red` 且失败原因（failures[].file/line）指向某任务 `## Touches` 命中的文件时，该任务的 `blocking` 临时置 `true` / `value` 大幅提升（如 +2）。
2. **义务生成器覆盖**：这条本身就是 `orchestration/manager-obligation-ledger.jsonl` 该覆盖的形状——「持续阻塞 suite 却排不上号」是一条可推导的义务，不该靠人工盯。
3. **接线**：`ready-pool-check` 的 `--json` 输出加 `blocking_suite` 字段（bool，来源=连续红窗判定），slot-refill 排序消费它。

**验证锚**：修后 (a) 同一 watchdog 缺陷在连续 3 轮红后 `blocking: true` / `value` 跃升、排到 recommended 前列；(b) 无连续红窗时排序不变（负控制）；(c) 真实连续红场景下 inner 能自动挑中它。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录实证（5 轮连续红同一缺陷 + value 0.25 排第 7 + blocking false + slot-refill 不含）（本任务 Proposal 已含；内层补：构造连续红窗 fixture ⇒ relevance 不变）
- [x] AC2: **blocking 动态置真**——`computeRelevance` 读 verification-round.jsonl 连续红窗（≥N 轮同一 Touches 命中）⇒ blocking 临时 true / value 提升
- [x] AC3: **排序生效**——同一缺陷在连续红后排到 slot-refill recommended 前列，inner 能自动挑中
- [x] AC4: **负控制**——无连续红窗时排序不变（不误伤）
- [x] AC5: **义务生成器**——「持续阻塞 suite 排不上号」进入 manager-obligation-ledger 推导义务（可机械检查，非散文）
- [x] AC6: **既有不回归**——`--for-task` scoped 门绿（ready-pool / slot-refill 既有测试）

## Definition of Done

- [x] AC1–AC6 全部勾上
- [x] 修后实跑：构造连续红窗 fixture ⇒ blocking true + 排前列（贴任务体）；无红窗不误伤
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/ready-pool-check.ts（computeRelevance/ready_relevance：读 verification-round.jsonl 连续红窗 ⇒ blocking 动态置真 / value 提升）
- plugin/scripts/slot-refill.ts（排序消费 blocking_suite 字段）
- plugin/test/ready-pool-check.test.mjs（AC2-AC4 fixture：连续红窗 ⇒ 排序跃升；无红窗不误伤）
- orchestration/manager-obligation-ledger.jsonl（AC5：义务生成器加「suite 阻塞缺陷排不上号」推导义务）
- tasks/gap-ready-relevance-blind-to-suite-blocking-signal.md（自身：勾 AC + 贴证据）

## Contract

measure   blocking_suite_flag = `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root <repo> --json` 的 ready_relevance[] 里该任务的 `blocking` 字段（连续红窗后）
band      blocking_suite_flag = true（连续 ≥3 轮红同一 Touches 命中 ⇒ blocking true）
invariant no_red_window_no_change = 1（无连续红窗时排序不变）
invariant slot_refill_picks_blocker = 1（blocking true ⇒ 排到 recommended 前列）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root <repo> --json`（连续红窗 fixture 贴回）
control   连续红窗 ⇒ blocking true 排前列；无红窗不误伤
resume    relevance 读红窗 + 义务生成器分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 红窗分诊 round-192/195/196 连续红同一 watchdog 缺陷 + manager 核实根因（computeRelevance blocking 只读静态依赖不读连续红窗）⇒ 立案。修：blocking 动态置真（读 verification-round.jsonl）+ 义务生成器覆盖。实现归内层

## Evidence（内层实现 2026-08-09）

### 根因

`computeRelevance` 的 `blocking` 轴只读 `childrenByTask`/`parentRefCount`（任务间静态依赖），不读
`<root>/.quay/verification-round.jsonl` 的连续红窗。一个连续 4-5 轮红同一 watchdog 缺陷
（round-192/193/195/196，round-194 aborted 仍红）的 `ready_relevance` 依旧 `value=0.25`、`blocking:false`、
排第 7，slot-refill recommended 不含它——真实、持续、可测量的信号没进任何判据（与 A14 背离度同族）。

### 修复

- `plugin/scripts/ready-pool-check.ts`：
  - 新增 `readVerificationRounds` / `readStateFailures` / `isRedRound` / `consecutiveRedRounds` /
    `collectFailureFiles` / `computeSuiteBlocking`——读连续红窗（默认 ≥3 轮 `state:red`，aborted 不打断窗，
    与 manager 把 round-192..196 计为连续红一致），失败明细取自 `full-suite-state.json` failures[]
    （及 fixture/未来每轮 `failures`），用 `expandDeclaredTouches`（与派发判据同一扩展示）把失败文件
    映射到任务的 `## Touches`。
  - `computeRelevance` 增第 5 参 `suiteBlockingIds`：命中 ⇒ `blocking` 动态置 true + `blocking_suite=true` +
    value 加 `SUITE_BLOCKING_WEIGHT=2`（value 从 0.25/1 跃升至 5）。输出加 `blocking_suite` 字段。
  - `analyzeTasks` 输出加 `suite_blocking`（`consecutive_red` / `min_red_window` / `window_active` /
    `failure_files` / `tasks`），`ready_relevance`/`top_relevance` 排序消费该信号。
- `plugin/scripts/slot-refill.ts`：candidate 收集后按 `pool.suite_blocking.tasks` 把 suite-blocking 任务
  排到最前，再进 `assembleBatch` ⇒ recommended 首位即 suite-blocker（AC3）；输出透传 `suite_blocking`。
- `orchestration/manager-obligation-ledger.jsonl`：新增 `OB-SUITE-BLOCKING-NOT-PRIORITIZED`（AC5）——
  该义务现在由 `ready_relevance[].blocking_suite` 机械推导（JSONL 行，非散文）。

### 修后实跑（连续红窗 fixture ⇒ blocking true 排前列）

构造 fixture：`gap-watchdog`（status:ready，`## Touches` 含 `code/wd.ts`）+ `gap-plain`
（`code/plain.ts`）；`.quay/verification-round.jsonl` 写 3 轮连续 `state:red,reason:failed`，failures
指向 `code/wd.ts`；`.quay/full-suite-state.json` failures 同。CLI 实跑：

```
$ node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root <fixture> --json
suite_blocking: {"consecutive_red":3,"min_red_window":3,"window_active":true,"failure_files":["code/wd.ts"],"tasks":["gap-watchdog"]}
ready_relevance[0]: {"id":"gap-watchdog","strategic":false,"blocking":true,"blocking_suite":true,"cost":1,"value":5,
                     "reason":"value 5 · strategic N · blocking Y(0 children) · suite-blocking Y · cost 1 touch"}
```

同一 fixture 下 `slot-refill` 的 `recommended[0]` 为 `gap-watchdog`（AC3）。负控制：无红窗/末轮绿时
`suite_blocking.window_active=false`、`blocking_suite=false`、排序回到原 id tie-break（不误伤，AC4）。

### 测试

- `plugin/test/ready-pool-check.test.mjs`（+5）：窗口检测、`computeSuiteBlocking` 负控制、
  `computeRelevance` suite-blocking 单测、`analyzeTasks` 端到端跃升 + 负控制、AC5 ledger 机械可检查。
- `plugin/test/slot-refill.test.mjs`（+1）：recommended 首位为 suite-blocker；无红窗不重排。

`--for-task` scoped 门：`fail 0` / `cancelled 0` / task-contract-check 0 违规。

全量套件绿（`FULL-SUITE-EXIT=0`）留外层 verification-round 验证（本任务 DoD 末行未勾）。
