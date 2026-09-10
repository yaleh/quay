---
id: gap-git-graph-lane-colour-assertion-assumes-contiguous-columns
title: AC9 配色断言假设列号连续，而生产窗口列号稀疏 ⇒ col % 8 必碰撞 ⇒ 间歇红烧掉无关任务的 fan-in（已实测 3 次 / 2
  个任务，其一是 GOAL-015 的 AC-233，被推进 needs-human）
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
## Proposal

**现象**：`packages/quay/test/gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored.test.mjs:354` 的 AC9 断言间歇性红，判词形如 `distinct column colours = min(8, 8) (got 5)`。它跑在 `@test-group product` 泳道，因此**每一次 fan-in 的全量 suite 都会跑它**——红了就整条 fan-in 失败，与被 fan-in 的那个任务改了什么完全无关。

**缺陷在测试，不在渲染器（两个假设给出相反预测，已用对照分开——硬规则 4 推论四）**：

- 渲染器逐字实现（位置判定）：`packages/quay/src/serve-git.ts:445` `function laneColor(col) { return lanePalette[col % lanePalette.length]; }`，`GIT_GRAPH_LANE_PALETTE` 长 8。
- 同文件 `:65` 声明的**真实不变量**只有一条：「column `c` draws with `var(--color-lane-(c % 8))`, so two **ADJACENT** columns always differ in hue」。
- 该不变量的断言就在 `:355-357` 的相邻列循环里，**三次失败中它一次都没红**——若渲染器真坏了，它必然先红。⇒ 渲染器合约成立。
- 红的是测试自己多加的一条更强断言 `assert.equal(distinct.size, Math.min(8, cols.length))`。**它只在列号连续（0..n-1）时成立**；`renderProduction()` 读的是**生产仓库实时状态**，列号随在飞分支/worktree 变化而稀疏，`col % 8` 于是碰撞。

**算术对照（一条命令可复现）**：
```
cols=8  稀疏=[0,1,2,3,4,8,9,16]              -> distinct=5  (断言期望 8)
cols=6  稀疏=[0,1,2,5,8,9]                    -> distinct=4  (断言期望 6)
cols=12 稀疏=[0,1,2,3,4,5,8,9,10,16,17,24]    -> distinct=6  (断言期望 8)
```
与实测判词 `min(8,8)(got 5)` / `min(8,6)(got 5)` / `min(8,12)(got 7)` 同族。

**发生率（硬规则 12，查历史而非等下一轮）**：`.quay/worker-outcome.jsonl` 解析出 **3 条**记录、跨 **2 个任务**：
```
2026-09-10T13:39:00Z  gap-fidelity-gate-not-wired-on-the-dominant-cli-activation-path   min(8,6)  got 5
2026-09-10T16:26:37Z  gap-shipped-entry-files-not-runnable                              min(8,12) got 7
2026-09-10T16:55:26Z  gap-shipped-entry-files-not-runnable                              min(8,8)  got 5
```
**代价是具体的**：`gap-shipped-entry-files-not-runnable` 因此连吃重试上限、被翻 **needs-human**（`needs_human_cause: human-adjudication`，判词逐字就是这条断言），**而它的 6 条 AC 全部已勾、Touches 只有 `plugin/test/shipped-entry-runnable.test.mjs` + `packages/quay/package.json`，与 git-graph 毫无交集**。该任务是 **GOAL-015 的 AC-233 的唯一实现任务** ⇒ 这条间歇红正在直接挡住一个 goal 的退出条件。

**⛔ 不要把它当 flaky 忽略或加重试**：它不是竞态，是一个**恒定为假的断言在特定数据下暴露**——同一份代码在列号连续时永远绿、稀疏时永远红。加重试只会把它变成更贵的随机阻塞（硬规则 4：一个取值依赖外生变量的量不是指标）。

## Plan

1. 把 AC9 的第一条断言改成渲染器**实际承诺**的那个不变量。两个候选，取其一并在测试注释里写明理由：
   - **(a) 相邻列必不同色**（`:65` 逐字承诺的那条）——已由紧邻的循环覆盖 ⇒ 第一条断言可直接删除，但须补一条「调色板确实被按列取用」的正向断言，⛔ 不能删成什么都不验。
   - **(b) 保留计数断言但按真实语义写**：`distinct.size === new Set(cols.map(c => c % PALETTE_LEN)).size`——即「颜色数 = 列号模调色板长后的不同值个数」。它对连续与稀疏两种输入都成立，且**仍能取假**（若 `laneColor` 改成常量或换了模数，它立刻红）。
   **建议 (b)**：它保留了一条真会红的量，而 (a) 只剩相邻性。
2. 补一条**负控制**：把 `laneColor` 临时改成常量 ⇒ 新断言必须红；还原 ⇒ 绿。
3. 补一条**稀疏输入的确定性用例**：用固定的稀疏列号集（不读生产状态）驱动一次渲染，钉死新断言在稀疏输入下为绿——**这条是防回归的关键**，因为生产窗口是否稀疏不由测试控制。
4. ⛔ 不改 `serve-git.ts` 的渲染行为（渲染器合约成立，改它会动 web 表层——正是 GOAL-015 退出条件④要守的东西）。

## Acceptance Criteria

- [x] AC1 根因存证（位置判定）：贴 `serve-git.ts:445` 的 `laneColor` 实现与 `:65` 的不变量注释原文，说明测试断言强于该不变量；并贴改前 `:354` 的断言原文。
- [x] AC2 稀疏输入确定性用例：新增一条用**固定稀疏列号集**（不读生产仓库状态）的用例，改前它红、改后它绿；贴前后两次运行输出。
- [x] AC3 负控制（能取假）：把 `laneColor` 临时改为返回常量 ⇒ 新断言红；还原 ⇒ 绿；贴两次输出与还原后的 `git diff` 为空。
- [x] AC4 生产窗口不再决定成败：`node --test packages/quay/test/gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored.test.mjs` 连跑 3 次全绿；且在**人为制造稀疏列号**（如临时多建几个分支引入非连续列）后再跑一次仍绿——贴四次的退出码与当次 `cols.length`/`distinct.size` 读数。
- [x] AC5 渲染器未被改动：`git diff --stat packages/quay/src/serve-git.ts` 为空（本任务不改渲染行为）。
- [ ] AC6 全量绿：`scripts/test.sh` 全量绿。（待外部）

## Definition of Done

AC9 的断言与渲染器实际承诺的不变量一致，对连续与稀疏两种列号输入都确定（同一份代码不会因生产仓库当时有几个分支而红/绿翻转），且仍能对「配色机制被拆掉」取假；`packages/quay/src/serve-git.ts` 逐字未改。⛔ 只把断言删掉、不补可取假的替代 ⇒ 不算达成（那是把一个假保证换成没有保证）。

## Touches

- packages/quay/test/gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored.test.mjs
- tasks/gap-git-graph-lane-colour-assertion-assumes-contiguous-columns.md