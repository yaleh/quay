---
id: gap-ac8-migration-semantic-test-update
title: tick-core-static-check AC8 断言过时——manager 侧死条目已迁出（5→0 标记行），`>= 6` 断言应改为新语义（剩余死条目带记号 + 迁出条目不在核内）
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（inner 2026-08-15 14:0xZ 立案——AC8 断言与「清死条目」人裁定方向冲突）**。

**现象**：`plugin/test/tick-core-static-check.test.mjs` AC8 断言 `out.ac8.excluded["orchestration/manager-tick-core.md"] >= 6`，实际 = 2。根因：人 2026-08-15 裁定清死条目，manager 侧 A7/A12a/B2c/乙/丁 五条已迁出核（换单行指针 → manager-phase-goal-archive.md），死标记行 5→0，剩余带排除记号的死条目仅 2。

**语义冲突**：AC8 旧语义「三层都用排除记号（manager 6 deducts）」——死条目在核内时须带「不计入覆盖率分母」。新现实（清死条目）：死条目迁出核（不在分母、不在排除计数、不在文件里），剩余在核内的死条目仍须带记号。⇒ 断言应从「>= 6」（具体历史计数）改为「按新语义」。

**AC8 核语义不变**：pairing rule（`scanDenomViolations`：核内死标记行必须同带「不计入覆盖率分母」）——`violations.length === 0` 保留。

**修法**：
1. `manager >= 6` → 断言「manager 核内【剩余】死条目仍带排除记号」（>= 1，标题不再写「6 deducts」）。
2. 新增断言：已迁出的 5 条（A7/A12a/B2c/乙/丁）**不在核内**（pointerized 到 archive，非死标记行）。
3. outer B4 / inner C7 的 `>= 1` 断言保留（语义不变）。

**判据1**：AC8 断言按新语义（剩余带记号 + 迁出不计数），不再依赖具体历史计数。
**判据2（能取假）**：真实 repo AC8 绿（violations=0）；若有死条目在核内不带记号仍红。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 tick-core-static-check.test.mjs AC8 断言 + tick-core-static-check.ts 的 excluded 输出形态。
2. 改断言为新语义（manager 剩余 >= 1 + 迁出条目不在核内检查 + 标题更新）。
3. 判据2 能取假：真实 repo AC8 绿；迁出条目不在核内。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：AC8 断言按新语义（剩余死条目带记号 + 迁出条目不在核内），标题更新，不再依赖 `>= 6` 具体计数。
- [ ] AC2 判据2 能取假：真实 repo AC8 绿（violations=0）；核内死条目不带记号仍红。
- [ ] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] AC8 断言语义更新（剩余 + 迁出）+ 真实 repo AC8 绿 + 测试绿——parser fan-in 解除阻断。

## Touches

- plugin/test/tick-core-static-check.test.mjs（AC8 断言语义更新）
- tasks/gap-ac8-migration-semantic-test-update.md（自身）
