---
id: gap-tick-core-drift-fast-mode-mode-conflict
title: fast-mode 对 tick-core drift check 是 byte-identical mode 但两副本非 byte-identical by design（SKILL.md 50725186 + AC76 item6）——恒红误导，改 mode 判定
status: ready
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

- [x] AC1 判据1：fast-mode 对 drift check 不恒红（mode 与实际关系一致）。
- [x] AC2 判据2 能取假：真实 repo 绿；单边改坏仍红（语义模式）或有明确处置（排除模式带理由）。
- [x] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] fast-mode drift 恒红消除（mode 与设计事实一致），不再误导读门者。

## Evidence

**裁决（Plan step 1）—— byte-identical 结构上不可能 ⇒ 改 drift-check mode 为语义同步。**

quay-init --loop 铺出布局（`plugin/skills/init/SKILL.md:68-71` 逐条）：
- `loop/orchestrator-loop-tick.md` → `orchestration/orchestrator-loop-tick.md`（byte-identical, no substitution）
- `loop/fast-mode-loop-tick.md` → `docs/analysis/fast-mode-loop-tick.md`（byte-identical, no substitution）
- `loop/orchestrator-tick-core.md` → `orchestration/orchestrator-tick-core.md`（byte-identical）
- `loop/fast-mode-tick-core.md` → `orchestration/fast-mode-tick-core.md`（**以 orchestration/ 本为正本；plugin/loop/ 为铺出模板——引用目标 docs/analysis 源，非 byte-identical，两副本承担不同角色**）

⇒ 目标项目只收 `docs/analysis/fast-mode-loop-tick.md` + `orchestration/fast-mode-tick-core.md`；**`plugin/loop/` 不被铺出**（`plugin/loop/orchestrator-loop-tick.md:43`「plugin/loop/ 是随包分发路径、不被 quay-init 铺出」）。故副本必须引用消费方落点 `docs/analysis/`，正本引用本仓源 `plugin/loop/` —— byte-identical 强制下这对结构上不可能变绿。git 历史佐证：`232e4171` 尝试 byte-identical 同步 → `cddc55e2`/`46068427` 两次回退（byte-copy 破坏 referenced⊆landed：铺出的 `orchestration/fast-mode-tick-core.md` 会引用目标项目不存在的 `plugin/loop/`）；SKILL.md:71 已是本任务落地前的权威声明。

**落地 fix**：
1. `plugin/scripts/tick-core-static-check.ts`：`DRIFT_PAIRS` 中 fast-mode 对改 `semantic` mode（新增 `FAST_MODE_SEMANTIC_PAIR`/`FAST_MODE_SEMANTIC_ROLE`）。语义比较 = ① A/B/C 条款集相等（缺/多条款红）② 逐条内容相等（剥 `(src:N)` 引用、归空白）③ 角色保持（副本引用 `docs/analysis/fast-mode-loop-tick.md`、不引用 `plugin/loop/fast-mode-loop-tick.md`）。orchestrator 对保持 byte-identical，manager 对保持 pointer。
2. `plugin/loop/fast-mode-tick-core.md`：副本条款语义同步正本——补 A16b（AC55 派发记录）/A26（AC81 锚核实）（正本新增、副本缺失），更新 A10/A13/A16/A20/B2/B3/C2（副本陈旧：动态 cap、inner 只写 `--task-start`、槽位五字段、「心跳无机械保证」等）。同步后两文件条款逐条一致（比对脚本：0 diff，47 codes each；src:N 行号两档一致——laid-down docs/analysis 与 plugin/loop 逐字节同源，SKILL.md:69）。
3. `plugin/test/tick-core-static-check.test.mjs`：fixture 副本改 semantic 变体（同条款、异 framing、引用 docs/analysis）+ 断言 fast-mode mode==semantic + 新增 3 条负控制。

**判据验证**：
- 判据1/2：`node --experimental-strip-types plugin/scripts/tick-core-static-check.ts --check-drift --root . --json` → `ok:true`，fast-mode 对 `~ semantic`（87 vs 101 行，条款一致）。负控制三个均 RED 且理由可区分：删 A26 → `semantic sync: missing clauses (正本→副本): A26`；A10 内容改坏 → `content drift: A10`；byte-copy 正本进副本 → `ROLE VIOLATION: 副本 must reference docs/analysis/... and NOT plugin/loop/... — byte-copy breaks referenced⊆landed`。
- 判据3：`node --test plugin/test/tick-core-static-check.test.mjs` → **24/24 pass**（21 既有 + 3 新）；`scripts/test.sh --for-task gap-tick-core-drift-fast-mode-mode-conflict --allow-thin` → **EXIT:0**。
- 注：`quay-init-loop-consumer-doc-refs`/loop-shipping 的 4 条 referenced-not-landed 失败经 `git stash` 验证为 **base 既有**（引用来自 orchestrator 文档 `orchestration/orchestrator-tick-core.md`/`plugin/loop/orchestrator-tick-core.md`/`orchestrator-loop-tick.md`，不在本任务 Touches；stash 后 base 同样 fail 2/4，恢复后无残留）。worktree 缺 node_modules，已 symlink 主检出 `/home/yale/work/quay/node_modules`（deps 逐字节一致）。

## Touches

- plugin/scripts/tick-core-static-check.ts（drift-check mode 分配 + 比较逻辑）
- plugin/test/tick-core-static-check.test.mjs（对应断言）
- plugin/loop/fast-mode-tick-core.md（如需，副本引用与正本一致化）
- plugin/scripts/checker-mutation-cases/tick-core-static-check.sh（fan-in 全量 suite checker-mutation-check 发现：semantic mode 下 mutation-case fixture 的 fast-mode 副本仍是 byte-identical、无 docs/analysis 角色引用 ⇒ 基线恒红 always-red；补角色引用头注，fixture 与 checker 新语义一致）
- tasks/gap-tick-core-drift-fast-mode-mode-conflict.md（自身）
