---
id: gap-tick-core-drift-fast-mode-mode-conflict
title: fast-mode 对 tick-core drift check 是 byte-identical mode 但两副本非 byte-identical by design（SKILL.md 50725186 + AC76 item6）——恒红误导，改 mode 判定
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（inner 2026-08-16 立案——AC76 landing 后 follow-up；drift RED 虽 --no-block 不挡提交，但恒红且已被误读为「挡提交」两次（outer 2026-08-16 误归因 + 我初判）——硬规则 3b：一个恒红的检查若无法区分「查过且合格」与「结构上不可能合格」，就是假的保证。）**

**现象**：`tick-core-static-check.ts --check-drift` 把 fast-mode 对标为 `byte-identical` mode（design intent：orchestrator/fast-mode 副本是 REAL copies, `:585-589`），实测 inconsistent（orchestration/fast-mode-tick-core.md 87 行 vs plugin/loop/fast-mode-tick-core.md 99 行，13 hunks）。**根因是设计冲突**：SKILL.md fix（gap-init-skill-md-byte-identical-claim-fix, landed 50725186）+ AC76 item 6 已裁定两副本**非 byte-identical by design**（正本引用 plugin/loop 源、副本模板引用 docs/analysis 铺出目标源，承担不同角色），byte-identical 强制下这对**结构上不可能**变绿 ⇒ 恒红、误导、--no-block 只能压声。

**先行澄清（必须）**：byte-identical 是否【真的不可能】取决于 quay-init --loop 铺出的目标项目里有什么。若铺出项目也有 `plugin/loop/fast-mode-loop-tick.md`（则副本可引用 plugin/loop、与正本 byte-identical，SKILL.md fix 是错的）；若只有 `docs/analysis/`（则副本必须引用 docs/analysis、byte-identical 结构上不可能，drift check 的 mode 是错的）。**任务第一步：调查 quay-init --loop 铺出的文件布局，裁决哪一方是错的。**

**判据1**：fast-mode 对 drift check 不再恒红——mode 改为与实际关系一致（byte-identical 恢复 或 语义同步判定 或 显式排除）。
**判据2（能取假）**：真实 repo drift check 绿（fast-mode 对不再恒红）；正本/副本任一单边改坏仍红（语义同步模式）或有明确处置。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 tick-core-static-check.ts `--check-drift`（`:585-589` mode 分配 + byte-identical 比较逻辑）+ quay-init --loop 铺出布局（plugin/loop/*.md 是否进新项目）。
2. 裁决：byte-identical 可恢复（改副本 src 引用 + 正本/副本逐字节一致）还是不可恢复（改 drift-check mode）。
3. 落地裁决 + 测试（负控制：单边改坏仍红）。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：fast-mode 对 drift check 不恒红（mode 与实际关系一致）。
- [ ] AC2 判据2 能取假：真实 repo 绿；单边改坏仍红（语义模式）或有明确处置（排除模式带理由）。
- [ ] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] fast-mode drift 恒红消除（mode 与设计事实一致），不再误导读门者。

## Touches

- plugin/scripts/tick-core-static-check.ts（drift-check mode 分配 + 比较逻辑）
- plugin/test/tick-core-static-check.test.mjs（对应断言）
- plugin/loop/fast-mode-tick-core.md（如需，副本引用与正本一致化）
- tasks/gap-tick-core-drift-fast-mode-mode-conflict.md（自身）
