---
id: gap-ac8-migration-semantic-test-update
title: tick-core-static-check AC8 断言过时——manager 侧死条目已迁出（5→0 标记行），`>= 6` 断言应改为新语义（剩余死条目带记号 + 迁出条目不在核内）
status: ready
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

- [x] AC1 判据1：AC8 断言按新语义（剩余死条目带记号 + 迁出条目不在核内），标题更新，不再依赖 `>= 6` 具体计数。
- [x] AC2 判据2 能取假：真实 repo AC8 绿（violations=0）；核内死条目不带记号仍红。
- [x] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] AC8 断言语义更新（剩余 + 迁出）+ 真实 repo AC8 绿 + 测试绿——parser fan-in 解除阻断。

## Touches

- plugin/test/tick-core-static-check.test.mjs（AC8 断言语义更新：剩余带记号 `>= 1` + 迁出条目不在核内检查 + 标题更新）
- plugin/scripts/tick-core-static-check.ts（头注释同步：Manager's 6 deducts → 剩余在核死条目 A4/A14，迁出集不再在核）
- tasks/gap-ac8-migration-semantic-test-update.md（自身）

## Evidence

**修前（主检出，AC8 红）** —— `node --test plugin/test/tick-core-static-check.test.mjs`：

```
✖ AC8: the real repo passes, all three layers use the exclusion notation (manager 6 deducts, outer B4, inner C7) (693.667078ms)
  AssertionError [ERR_ASSERTION]: manager excluded-dead count < 6 (6 deducts not all executed): {"orchestration/manager-tick-core.md":2,"orchestration/orchestrator-tick-core.md":8,"orchestration/fast-mode-tick-core.md":1}
      at file:///home/yale/work/quay/plugin/test/tick-core-static-check.test.mjs:372:10
ℹ tests 21 · pass 20 · fail 1
```

**修后（worktree）** —— 同测试全绿（21/21）：

```
✔ AC8: the real repo passes, three-layer exclusion notation (manager remaining in-core dead items carry the marker; migrated A7/A12a/B2c/乙/丁 are archived pointers, not in-core dead lines; outer B4, inner C7) (646.103417ms)
ℹ tests 21 · pass 21 · fail 0
```

**AC8 checker 输出（worktree，`--only ac8 --json`）**：`ok=true`，`violations=[]`，`excluded={manager:2, outer:8, inner:1}`，`dead={manager:0, outer:8, inner:1}`——manager 核内已无 DEAD_ANNOT_RE 死标记行（0），剩余带「不计入覆盖率分母」的 A4/A14 两条（2）仍带记号 ⇒ `>= 1` 成立；pairing rule（violations=0）保留。

**迁出检查证据（A7/A12a/B2c/乙/丁 五条）** —— 逐条核：指针在核 + 正文在档案 + 核内无死标记行：

```
A7:   pointer_in_core=True body_in_archive=True dead_lines_in_core=0
A12a: pointer_in_core=True body_in_archive=True dead_lines_in_core=0
B2c:  pointer_in_core=True body_in_archive=True dead_lines_in_core=0
乙:   pointer_in_core=True body_in_archive=True dead_lines_in_core=0
丁:   pointer_in_core=True body_in_archive=True dead_lines_in_core=0
```

核内指针形态（示例）：
```
| A7 | ~~**正身已迁出**（已退役，2026-08-15 迁出）~~ → `orchestration/manager-phase-goal-archive.md#§A7-migrated` (src:1520 "三层缺「审视者」职责") |
```
档案锚点（`orchestration/manager-phase-goal-archive.md`）：`### §A7-migrated（原文逐字）`、`### §A12a-migrated（原文逐字）`、`### §B2c-migrated（2026-08-15 12:1xZ 迁出，同上）……`、`### §乙-migrated（2026-08-15 12:1xZ 迁出，同上）……`、`### §丁-migrated（2026-08-15 12:1xZ 迁出，同上）……`。

**能取假（AC2 判据2）**：
- 既有负控制保留：核内死条目不带「不计入覆盖率分母」仍红（`AC8: a dead-annotated item WITHOUT the denominator-exclusion marker reddens` 通过）；
- 迁出检查可取假（对真实 core 模拟回归）：A7 重引入为 `| A7 | **前提已死** | 不能执行 (src:1) |` ⇒ `deadLines.length=1` ⇒ `assert.equal(0)` 红；指针丢失 ⇒ `assert.ok(includes(pointer))` 红。

**scoped 门（AC3 判据3）** —— `scripts/test.sh --for-task gap-ac8-migration-semantic-test-update --allow-thin`：`EXIT:0`；全部 scoped 静态检查 PASS（test-framework-policy / test-isolation / tmp-leak-pairing / test-impl-census / task-contract 0 violations / malformed-task / superseded-capability / landing-target）+ 选中套件 tick-core-static-check.test.mjs 21/21 绿。
