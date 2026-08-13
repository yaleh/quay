---
id: gap-ac48-code-retirement-pool-filter-and-scripts
title: AC48 代码面承接——ready-pool-check pool 过滤层取消 + integration-branch-model.ts/integration-batch-merge.sh 退役标注
status: ready
labels:
  - gap
  - mechanism
  - defect
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**AC48 判据2（manager-phase-goal.md:2839）逐字列出三件退役动作**：删除分支 + 清理其引用
（`integration-batch-merge.sh` / `integration-branch-model.ts` / `SPEC-branching-model-integration-branch-2026-08-05.md`
加退役标注但**不删**——它是理由档案）。**scope 扩展后判据2 相应含**：`ready-pool-check` 的 pool 过滤层取消
+ 其引用加退役标注（不删，理由档案）。

**分工**：分支删除 + SPEC 文档标注 + config merge_target→develop 由 outer 已完成（d41feba6/fc39e997）。
**本任务 = AC48 的代码面**（ready-pool-check pool 过滤层取消 + 两脚本退役标注），此前只活在 outer 给 inner 的
brief 里、没有任务承接——**manager 2026-08-13 三法查证无承接者，且「已协调 inner」的寿命上界=下一次压缩**
（SendMessage 落上下文、compact 后不可重读；workflow 实践死在 2026-08-08 压缩边界上）。**今天第 4 次同形状**：
已成立的工作没有一个能活过上下文的归属。立案=给已有工作一个住处，**不是新增范围**（AC48 判据2 早已列出）。

## Plan

1. **ready-pool-check.ts pool 过滤层取消**：`pool < floor`（floor=cap×4）对 todo→ready bulk promotion 的门控取消
   ——**先标注引用再取消过滤层**（引用加退役注释，不删——理由档案）。A22 每 tick 跑 `--apply` 依赖此逻辑，
   取消后 A22 行为变为「合格即晋，不看 pool 大小」——与 SPEC-task-status-flow 目标模型一致（outer 修不合格 +
   尽力晋，不考虑 pool）。注意与 AC48 的「先立不破」：取消动作在 per-task 验证为默认认证之后（已成立）。
2. **`integration-branch-model.ts` + `integration-batch-merge.sh` 头部退役标注**（不删——两线模型理由档案；
   catalog:197 已记 integration-branch-model.ts ZERO production callers slated for retirement per AC52）。
3. **负控制**：ready-pool-check 既有测试全绿；`--for-task` scoped 门绿；A22 `--apply` 在 pool<floor 且有候选时
   仍能晋、无候选时零写。

## Acceptance Criteria

- [ ] AC1 ready-pool-check pool 过滤层取消（`pool < floor` 门控移除），引用加退役标注不删。
- [ ] AC2 A22 行为验证：`--apply` 合格候选照晋（不看 pool 大小）、无候选零写（负控制）。
- [ ] AC3 integration-branch-model.ts / integration-batch-merge.sh 退役标注落地（不删，理由档案）。
- [ ] AC4 既有 ready-pool-check / integration-batch-merge / branch-model 测试全绿；`--for-task` scoped 门绿。
- [ ] AC5 AC48 判据2 代码面完成（三件退役动作中代码两件 = 本任务；分支+文档已由 outer 完成）。

## Definition of Done

- [ ] pool 过滤层取消 + 两脚本退役标注落地，负控制通过。
- [ ] AC48 判据2 代码面闭合（与 outer 的 doc/ops 面合并即 AC48 判据2 完整）。

## Touches

- plugin/scripts/ready-pool-check.ts（pool 过滤层取消 + 引用退役标注）
- plugin/scripts/integration-branch-model.ts（退役标注，不删）
- plugin/scripts/integration-batch-merge.sh（退役标注，不删）
- plugin/test/（负控制用例：A22 apply 行为）
- tasks/gap-ac48-code-retirement-pool-filter-and-scripts.md（自身）

## Evidence

**AC1 —— ready-pool-check pool 过滤层取消（`pool < floor` 门控移除），引用加退役标注不删**：
`plugin/scripts/ready-pool-check.ts` 中 bulk promotion 的 `if (deficit > 0)` 门控（`pool < floor`）与
`if (promotions.length >= deficit) break` 上限已移除——候选扫描始终执行、每个合格候选都晋（合格即晋，
不看 pool 大小）。头部 + 各引用处（item 3、`--apply`/`--targeted` CLI 注释、`computePoolFloor`、
HEARTBEAT MODE 注释、`applyPromotions`）均加 `RETIRED (AC48)` 标注，注释不删（理由档案）。

**AC2 —— A22 行为验证（`--apply` 合格候选照晋、无候选零写）**：`applyPromotions` 的 `should_apply`
条件由 `deficit > 0 && promotions.length > 0` 改为 `promotions.length > 0`。测试
`--apply: pool >= floor with qualified candidate ⇒ apply lands it` 实证 pool≥floor 且合格候选时照晋；
`--apply heartbeat negative control: promotions empty ⇒ zero writes` 实证无合格候选零写（负控制）。

**AC3 —— integration-branch-model.ts / integration-batch-merge.sh 退役标注落地（不删）**：
两脚本头部加 `RETIRED (AC48 判据2, catalog per AC52)` 标注——分支删除 + config merge_target→develop
由 outer 完成（d41feba6/fc39e997），两脚本 + SPEC 文档为两线模型理由档案，保留不删。

**AC4 —— 既有测试全绿 + scoped 门绿**：`scripts/test.sh --for-task gap-ac48-code-retirement-pool-filter-and-scripts --allow-thin`
→ 166 tests pass / 0 fail；scoped static checks 全 PASS（test-framework-policy / test-isolation /
tmp-leak / adr016 / superseded-capability / dead-code-after-return / concurrency-literal / landing-target /
judgment-consumer / delivery-inventory）。3 条编码旧 `pool≥floor ⇒ 不晋` 行为的测试（ready-pool-check.test.mjs
原 `pool >= floor ⇒ no promotions`、targeted 测试的 bulk-promotions-空断言、apply 负控制）已更新为
编码新「合格即晋」行为。integration-branch-model 58 测试绿。

**AC5 —— AC48 判据2 代码面完成**：三件退役动作中代码两件（pool 过滤层取消 + 两脚本退役标注）由本任务落地；
分支删除 + SPEC 文档标注由 outer 完成（d41feba6/fc39e997）。
