---
id: gap-slot-refill-repeats-done-eligible-recommendations
title: slot-refill 反复重派「已落地待翻 done」的任务——not-yet-flipped 被 ready-pool-check
  算出却没接进推荐路径（:243 只遍历 pool.ready + 3 项 step-4 检查，grep not-yet-flipped|excluded =
  0 命中）；今日 25 条重派/复验提交自述，每条都是 subagent 复核已落地工作
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

**`plugin/scripts/slot-refill.ts` 的候选循环（`:243`）从不看 `pool.excluded`——`ready-pool-check` 算出了「工作已落地、只差 AC5 翻 done」的 `not-yet-flipped` 信号（16 条 excluded 中 14 条 not-yet-flipped），但 slot-refill 只遍历 `pool.ready` + 三项 step-4 检查（touches-resolve / deps-ready / concurrency-disjoint）。结果：已 fan-in、只待 AC5 verification-round 翻牌的任务每轮都被重新推荐 ⇒ inner 每轮重派一个 subagent 去复核【已经落地的工作】。今日 25 条重派/复验提交自述，每条烧一个 subagent。**

### 实证（manager 2026-08-10 18:4x 按位置核 + outer 复核）

- **inner 18:38 心跳**：「系统性重派发现: 8+ 任务已 fan-in 但 status=ready (AC5 待外层 verification-round) 致 slot-refill 反复推荐+反复重派浪费 subagent; 需外层翻 done 或 dispatch 去重」
- **manager 核到实现层**：
  - `ready-pool-check` **确实算出了**这个排除：`excluded` 16 条，reasons 全为 `not-yet-flipped`。
  - `slot-refill.ts:65-69` 只导入 `analyzeTasks / POOL_FLOOR_MULT_DEFAULT / readGitRevCount`。
  - `:243` `for (const id of pool.ready)` 直接遍历 `pool.ready`。
  - 其后三项 step-4 检查：`checkTaskTouchesResolve`(:248) / `depsReadyFor`(:252) / `checkTouchesPair` 与在飞不相交(:256)。
  - 全文 `grep not-yet-flipped|excluded` = **0 命中**。
- **代价（已测）**：今日提交信息中自述为重派/复验的 = **25 条**（`45dd9adc … re-dispatch 2026-08-10 复验`、`53b852fc … 重验证（re-dispatch）`、`7de63aaf … re-dispatch 复核`、`765741bc … 重派复验`）。每一条都是一个 subagent 跑完整流程复核已落地工作。

### 选定机制方向（实现归 inner，判定归 outer；manager 推荐 B）

- **候选 A（止血，治标）**：绿轮后做 closure-pass 翻 done（outer 已做过一次，`4c391b4d` flip 8）。但依赖绿轮（~32 分钟且今日多次因无关原因红），积压反复出现。
- **候选 B（结构解，manager 推荐）**：`slot-refill` 候选循环加**第 4 项 step-4 检查**——跳过 `pool.excluded` 中 reason 含 `not-yet-flipped` 的 id。信号已现成（同一 `analyzeTasks` 的产物），改动落在 `:243` 循环里，与既有三项检查同形。**「工作已落地」与「还能被派发」在机制上不再矛盾。**
- 注：B 不改变 AC5 的严格性——任务仍要等绿轮才 done，只是不再被重复派发去证明同一件事。

**验证锚**：修后 (a) 一个「已 fan-in、status=ready、AC5 待翻」的任务不再被 slot-refill 推荐；(b) 未 fan-in 的 ready 任务仍正常推荐；(c) 既有三项 step-4 检查不回归；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 inner 18:38 心跳 + manager 实现层核对（:243 无 not-yet-flipped/excluded 引用 + grep 0 命中 + 25 条重派提交自述）（本任务 Proposal 已含）
- [ ] AC2: **第 4 项 step-4 检查**——slot-refill 候选循环跳过 `pool.excluded` 中 reason 含 `not-yet-flipped` 的 id
- [ ] AC3: **既有不回归**——`--for-task` scoped 门绿；slot-refill 既有 3 项 step-4 检查不破坏
- [ ] AC4: **不改变 AC5 严格性**——not-yet-flipped 任务仍等绿轮翻 done，只是不再重复派发

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：构造「已 fan-in 待翻 done」任务 ⇒ slot-refill 不再推荐（贴候选列表前后对比）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/slot-refill.ts（:243 候选循环加第 4 项 step-4 检查：跳过 not-yet-flipped）
- plugin/test/slot-refill.test.mjs（新增用例：not-yet-flipped 不推荐；未 fan-in 仍推荐）
- plugin/scripts/capability-catalog.sh（若改动声明问题——slot-refill 已在 catalog？）
- tasks/gap-slot-refill-repeats-done-eligible-recommendations.md（自身：勾 AC + 贴证据）

## Contract

measure   slot_refill_skips_nyf = `grep -cE "not-yet-flipped|excluded" plugin/scripts/slot-refill.ts` 的 stdout 数字
band      slot_refill_skips_nyf >= 1（第 4 项 step-4 检查已接线）
invariant nyf_task_not_recommended = 1（已 fan-in 待翻 done 的任务不被 slot-refill 推荐）
invariant unfanned_ready_still_recommended = 1（未 fan-in 的 ready 任务仍正常推荐）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root <repo> --json`（贴候选列表，证明 not-yet-flipped 不在）
control   跳过 nyf；未 fan-in 仍推荐；AC5 严格性不变
resume    第 4 项检查 / scoped 门 / 全量验证分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 18:4x 核到实现层——slot-refill :243 只遍历 pool.ready + 3 项 step-4 检查，not-yet-flipped/excluded grep 0 命中，而 ready-pool-check 已算出 16 excluded/14 nyf。今日 25 条重派提交自述。处方：第 4 项 step-4 检查跳过 not-yet-flipped（manager 推荐 B）。实现归 inner，判定归 outer
