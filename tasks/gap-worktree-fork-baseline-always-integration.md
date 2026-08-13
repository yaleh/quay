---
id: gap-worktree-fork-baseline-always-integration
title: 阶段零——worktree 建立基线 integration→develop（新模型 fan-in 直连 develop +
  rebase-重跑循环吸收任务文件漂移；验收双证①基线 ②rebase 后不冲突）
status: ready
labels:
  - gap
  - defect
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**管理 2026-08-13 实测（枚举 `git rev-list develop..<branch>`，不是计数）**：两个在飞 worktree
（idempotency / one-shot-worktree）的 `develop..分支` 各 1 条 → 都是 92d7a41c —— **integration 独有提交**。
早先基线 `c23bf2fa` 的 3 个 worktree 排空、2 个新的立刻补位 ⇒ **集合在轮换**——阶段二（在飞收口）与派发
赛跑且派发一直赢，永不收敛。

**⚠️ 根因更正（manager 2026-08-13 二次更正——第一版根因是错的，本任务第一版 Proposal 别照旧）**：
「worktree 100% fork 自 integration」**不是矛盾，是刻意设计**。`fork-baseline.ts:182-186` 的
`--force-integration` 是**显式分支**（带署名理由），不是文档冲突：
```
fast-mode-loop-tick.md:949  fork-baseline.ts … --develop "$FORK_BASELINE" --integration "$MERGE_TARGET" --force-integration
fast-mode-loop-tick.md:950  # stdout: $MERGE_TARGET（统一 = integration HEAD；--force-integration 强制，无视依赖声明）
fast-mode-loop-tick.md:956  依赖声明语义保留在 fork-baseline.ts 默认路径（单线下游用），quay 自身派发用 --force-integration 统一
fork-baseline.ts:182-186    if (forceIntegration) { 输出 integrationRef }   ← 显式分支，带署名理由
```
理由 = 一个**已立案已修**的缺陷：`gap-task-file-develop-integration-drift-fan-in-conflicts` ——
**fork 点 = fan-in 目标**，否则任务文件的证据段会与 integration 上已更新的同名文件 rebase 冲突。

**manager 的错误形状（一并记入，它比原结论有用）**：只读 `fast-mode-loop-tick.md:953` 一行就下结论
「两处矛盾」——正是它批评我「把候选集上限读成派发上限」的同族错误。**「查现状必须查被执行的那一行」没错，
但执行时不能只读那一行，要读它上下的上下文（:949/:950/:956 + fork-baseline.ts:182-186）。**

**两条独立成立的事实（不受根因更正影响）**：
1. **`integration-branch-model.ts:46 forkBaseline()` 零生产调用者**——调用点清单（枚举）：
   - `integration-branch-model.ts:209` —— 同模块 CLI `--fork-baseline` 子命令；被 tick 核列为 A15④ 可选项，
     但实际执行路径（fast-mode-loop-tick.md:953）跑的是 `fork-baseline.ts`，无脚本实际调用此 CLI。
   - `plugin/test/integration-branch-model.test.mjs:43/47/51` —— 直接 import 单测。
   - **生产调用者：零**。`fork-baseline.ts` 不 import integration-branch-model.ts（import 为
     gate-script-base / touches-orthogonality-check / concurrent-batch-scheduler）。
   ⇒ **同一概念两套并行实现，CLAUDE.md 记的是死的那套**（manager 2026-08-13：它的文件，它改）。
   AC52 修法按「先确认从没用过」定。
2. **AC50 不可收敛是真的**——时间戳与逐条枚举不受更正影响：92d7a41c(04:28:02Z, integration 独有)
   → 两个 worktree(04:30:14/15Z) 各含它 1 条非自己的提交。

## Plan（正本 orchestration/SPEC-per-task-suite-verification-2026-08-13.md 阶段零 §15.4，已按更正改写）

**不是「修一处矛盾」，而是「先解掉 `--force-integration` 当初要解的那个问题」。直接把基线指向 develop
会重新引入一个已修缺陷（任务文件证据段 rebase 冲突）——旧写法照做 = 制造回归。**

**新模型下的解法已经存在，只是必须明写**：per-task 验证下任务直接 fan-in `develop`；任务文件漂移由
`fast-mode-tick-core.md:25 A6` 已有的「先 `git rebase $MERGE_TARGET` 再 merge」+ 人已裁定的 rebase-重跑
循环吸收。**代价 = rebase 后要重跑套件**——正是人 2026-08-13 裁定④「同意 Rebase-重跑循环的必要性」买下的。

1. worktree 建立基线从 `$MERGE_TARGET` 改 `develop`（新模型 fan-in 直连 develop）。
2. 任务文件漂移吸收走 rebase-重跑循环（fast-mode-tick-core.md:25 A6 已有路径）。
3. **验收双证**：①新建独立任务 worktree `git rev-list develop..<分支>` 为空或只含它自己的提交；
   ②一个任务在 fan-in 前被 rebase 到新 develop 后，其任务文件证据段不冲突 **且** 套件重跑通过。
   只证①不够——那正是 `--force-integration` 当年绕开的那一半。

## AC

- [ ] AC1: worktree 建立基线从 `$MERGE_TARGET` 改 `develop`（per-task fan-in 直连 develop）
- [ ] AC2: **验收①**——新建独立任务 worktree，`git rev-list develop..<分支>` 为空或只含它自己的提交
- [ ] AC3: **验收②**——一个任务 fan-in 前 rebase 到新 develop：任务文件证据段不冲突 **且** 套件重跑通过
- [ ] AC4: `forkBaseline()`（integration-branch-model.ts:46）零生产调用者确认写进档案；AC52 修法按「先确认没用过」定
- [ ] AC5: `fast-mode-loop-tick.md:953` + 三层 tick 文档 integration 引用同步（改一处等于没改）
- [ ] AC6: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC6 全部勾上
- [ ] 验收① 与 验收② 的对照样例贴出（新建 worktree rev-list + rebase 后 fan-in 实证）
- [ ] 全量套件绿

## Touches

- plugin/loop/fast-mode-loop-tick.md（:953 worktree 建立基线 → develop）
- plugin/scripts/fork-baseline.ts（--force-integration 默认路径 / 退役或改）
- orchestration/fast-mode-tick-core.md + plugin/loop/fast-mode-tick-core.md（A15④ 基线语义同步；A6 rebase-重跑循环已是路径）
- orchestration/SPEC-per-task-suite-verification-2026-08-13.md（阶段零 §15.4）
- tasks/gap-worktree-fork-baseline-always-integration.md（自身）
