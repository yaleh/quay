---
id: gap-red-window-cap-trigger-backlog-not-suite-red
title: 红窗降 cap 触发条件过严——`suite_red && backlog>50` 双条件（backlog=10 未达 ⇒ 红窗 cap 仍 5）；人裁定红窗本身即触发降 cap + red_backlog_cap=2 字面量需记录 + 不得停派（死锁）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实测（manager 2026-08-13，slot-refill arbitration）**：
```
suite_red           = True
red_window_active   = True
integration_backlog = 10
backlog_threshold   = 50      ← 未达阈值
red_backlog_cap     = 2       ← 收窄后的目标 cap，已定义
cap_narrowed        = False   ← 所以【没有收窄】
effective_cap       = 5 = base_cap
```
**现行触发 = `suite_red && backlog > 50` 双条件**；backlog 才 10 ⇒ 红窗里 cap 仍是 5。
**人 2026-08-13 08:1xZ 裁定**：「红窗在主会话修」这个规则后续可以取消。**红窗时可以减少 subagent 数量，
但不要在主会话修** ⇒ 红窗降并发 = **红窗本身触发降 cap**：`red_window_active ⇒ cap → red_backlog_cap`，
不再要求 backlog 超阈值。这是一处条件放宽，不是新机制。

**⚠️ 不得把红窗改成停派**：实测 `should_refill=True / dispatchable_disjoint=10 / slots_free=5`——
红窗没停派。**降 cap ≠ 停派**；与「不在主会话修」组合成停派 = **死锁**（不能派、又不能主线程 ⇒
红窗里什么都做不了）。实现 ① 时不得顺手把红窗改成停派。

**red_backlog_cap = 2 字面量（硬规则4推论二）**：写死数字的合理性依赖机器规格（同 `cpuQuota:"400%"` 族）。
人说不搞复杂——先**记录可追溯**：为什么是 2、什么时候要改（或改读宿主派生，但非本次）。

## Plan

1. `slot-refill.ts` arbitration 触发条件：`suite_red && backlog > 50` → `red_window_active`（红窗本身触发降 cap）。
2. **不把红窗改成停派**（降 cap 保持派发）。
3. `red_backlog_cap = 2` 的缘由记录进任务体/档案（为什么 2、什么时候要改）。

## AC

- [x] AC1: `red_window_active ⇒ cap 收窄到 red_backlog_cap`（不再要求 backlog > 阈值）
- [x] AC2: 红窗保持派发（降 cap 不停派——should_refill 逻辑不变）
- [x] AC3: `red_backlog_cap = 2` 缘由记录（为什么 2、什么时候要改）
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Implementation

`slot-refill.ts` arbitration 触发条件由 `suite_red && backlog > 50` 放宽为 **`red_window_active` 单独触发**：

- `computeArbitratedCap({ baseCap, redWindowActive, redBacklogCap })` —— `redWindowActive ⇒ redBacklogCap`，否则 baseCap。
- `analyzeSlotRefill` 两遍池分析：**第一遍以 baseCap 分析**（`suite_blocking.window_active` 与 cap 无关，
  是权威红窗读数）；窗口激活 ⇒ 收窄时**第二遍以 effectiveCap 重分析**（floor 等 cap 派生统计与
  旧「单遍以 effectiveCap」行为一致）。
- **降 cap ≠ 停派**（AC2）：`should_refill` 逻辑未动——`slots_free = effectiveCap - occupied` 仍 > 0 且
  `recommended` 非空时照常派发，只是并发槽从 5 收窄到 2。
- `RED_BACKLOG_THRESHOLD_DEFAULT` 常量与 `--red-backlog-threshold` CLI flag 已从机制中删除
  （backlog 不再是触发条件）；`integration_backlog` 仍作为诊断读入并回报。
- 仲裁回报字段：`red_window_active`（触发量）、`cap_narrowed`、`suite_red`/`integration_backlog`（诊断）；
  不再回报 `backlog_threshold`。

## red_backlog_cap = 2 —— 缘由记录（AC3）

**为什么是 2**（硬规则 4 推论二：写死数字的合理性依赖机器规格，需记录可追溯）：
- 红窗的意图是「只够修红即可」——收窄到 **够派发红窗修复任务、又不加 WIP** 的最小并发。
- 2 = 1 个修红任务 + 1 个余量（红窗期间主会话不修、其他任务可能仍在飞，需留一个槽给并列的
  必要并发）；实测 `should_refill=True / dispatchable_disjoint=10 / slots_free=5` 说明 2 是一个
  **节流值**，不是停派值。
- 2 是 **2026-08-09 固定 cap=5 时代的比例下限**：cap 5 的 40%（红窗把并发砍到 40% 当量）。

**什么时候要改**：
- 若宿主并发规格变化（如默认 cap 从 5 改到 N），`red_backlog_cap` 应按「≈ 修红任务数 + 1」重新裁定，
  并同步更新本段。当前不搞复杂（人 2026-08-13：不读宿主派生，先记录可追溯）。
- 若红窗下反复出现「派了 2 个仍修不红 / 派 2 个反而互相踩 touches」，先测再改——不要凭感觉调数字。

## 对照样例（DoD）

红窗下 cap 收窄 + 仍派发（测试 `ARBITRATION — red window ALONE narrows the cap even with backlog below the old threshold (AC1 regression)` 的实测输出）：
```
suite_red           = True
red_window_active   = True      ← 触发量（3 连红轮）
integration_backlog = 10        ← 低于旧阈值 50，仍收窄（回归点）
base_cap            = 5
effective_cap       = 2         ← 红窗 ⇒ 收窄到 red_backlog_cap
cap_narrowed        = True
slots_free          = 2         ← 仍 > 0 ⇒ should_refill 逻辑不变（降 cap 不停派）
```

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 红窗下 cap 收窄 + 仍派发的对照样例贴出
- [ ] 全量套件绿（fan-in 时跑全量；scoped 门绿已证，见 commit）

## Touches

- plugin/scripts/slot-refill.ts（arbitration 触发条件）
- plugin/test/slot-refill.test.mjs（arbitration 测试改写：红窗 fixture + 纯函数签名）
- tasks/gap-red-window-cap-trigger-backlog-not-suite-red.md（自身）
