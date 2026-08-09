---
id: gap-fixed-cap-5-dynamic-cap-retired
title: 动态 cap 作废改固定 5（人裁定）——effective_cap 是被包装成数字的布尔量且算错了（process-budget 报
  in_use=5 实 1 个 MainThread）；cap-from-gate/slot-refill 固定 5，process-budget 降级观测
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

**动态 cap 机制作废（人 2026-08-09 裁定）：`effective_cap` 与 `slot-refill --cap` 默认值改为固定 5。动态 cap 是「被包装成数字的布尔量，且那个布尔量还算错了」——它除了表示 suite 测试在跑，没有其它价值。停止使用它，固定 cap=5 也比它好。`cap-from-gate.sh` / `process-budget.sh` 降级为纯观测，不得参与任何裁决（派发、slot-refill、floor 计算一律用固定 5）。**

### 实证（manager 2026-08-09 实测 + outer 复核）

- **cap 历史分布**：`4(40) / 1(36) / 5(25) / 2(21) / 3(5)`——`cap=1` 每 3~4 轮出现一次，且只随「suite 跑不跑」切换。⇒ 被包装成数字的布尔量。
- **计数错误**：`process-budget.sh` 报 `total_budget=4 in_use=5 available=0 verdict=WAIT`，但同时刻 `ps` 数 node MainThread 只有 1~2 个——**WAIT 裁决建立在错误计数上**。
- **人裁定**：停止使用动态 cap，固定 cap=5。

**为什么重要**：动态 cap 让槽位/池位判据随负载波动（我今晚三条矛盾指导的根源）；且其底层计数错误（in_use 报 5 实 1）让 WAIT 裁决不可信。固定 cap=5 消除波动，池位判据稳定（pool 28/floor 20/deficit 0）。

**修的方向（实现归内层）**：
- 候选 A：`cap-from-gate.sh` 的 `effective_cap` 改为固定 5（保留脚本输出作观测）。
- 候选 B：`slot-refill.sh` 的 `--cap` 默认值改为 5（不传时用 5）。
- 候选 C：`process-budget.sh` 的 `in_use` 计数修（报 5 实 1——找计数 bug）。

**验证锚**：修后，(a) `effective_cap` 恒 5（不随 suite 跑不跑变）；(b) `slot-refill --cap` 默认 5；(c) `process-budget in_use` 与实际进程数一致。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录实证（cap 分布 4/1/5/2/3 + cap=1 只随 suite 切换 + process-budget 报 5 实 1）（本任务 Proposal 已含；内层补：cap-from-gate 实跑 + ps 对照复现）
- [ ] AC2: **effective_cap 固定 5**——`cap-from-gate.sh` 恒输出 5（不随 suite 跑不跑变）
- [ ] AC3: **slot-refill 默认 5**——`--cap` 不传时用 5（floor=20）
- [ ] AC4: **process-budget 计数修正**——`in_use` 与实际 node MainThread 进程数一致（不再报 5 实 1）
- [ ] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 cap/slot-refill/process-budget 契约检查）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：effective_cap 恒 5；slot-refill 默认 5；process-budget in_use 与实际一致（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/cap-from-gate.ts（候选 A：effective_cap 固定 5）
- plugin/scripts/slot-refill.ts（候选 B：--cap 默认 5）
- plugin/scripts/process-budget.sh（候选 C：in_use 计数修——报 5 实 1）
- plugin/test/（新增：effective_cap 恒 5；slot-refill 默认 5；process-budget 计数）
- tasks/gap-fixed-cap-5-dynamic-cap-retired.md（自身：勾 AC + 贴证据）

## Contract

measure   effective_cap_stability = `bash plugin/scripts/cap-from-gate.sh` 的 effective_cap 值（suite 跑/不跑各测一次）
band      effective_cap_stability = 两次都 = 5（不随 suite 切换）
invariant slot_refill_default_5 = 1（--cap 不传 ⇒ floor=20）
invariant budget_count_accurate = 1（in_use 与实际 node MainThread 一致）
invoke    `bash plugin/scripts/cap-from-gate.sh` + `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts`（贴回）
control   suite 跑/不跑 effective_cap 都 5；slot-refill 默认 5；in_use 准确
resume    cap 固定 + slot-refill 默认 + 计数修分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（人裁定：动态 cap 作废改固定 5——cap 是被包装成数字的布尔量且算错了（报 5 实 1）；cap-from-gate/slot-refill 固定 5，process-budget 降级观测+计数修。实现归内层）
