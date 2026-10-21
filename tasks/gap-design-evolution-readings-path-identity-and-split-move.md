---
id: gap-design-evolution-readings-path-identity-and-split-move
title: 设计演进读数例程首个生产读数暴露的三处仪器缺陷：RM2 按文件名归并且未把 worktree 绝对路径归一为仓库相对路径；形态 2
  有计数无出处；RM1 的「单次最大中心变动提交」漏掉拆成多次提交的搬家
status: ready
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

设计演进读数例程（`gap-design-evolution-readings-report-only-routine`，done）合并后，anchor 于 2026-10-21T23:08:45Z 自动重启 quality 驱动，例程于 23:14:08Z 写出第一条生产记录（`.quay/design-evolution-history.jsonl`，head 5c74f38f2，`evaluated:true`，`predicateSelfCheck.ok:true`）。逐项核对这条记录，发现三处属于**元仪器本身**的测量缺陷（另有两处是配置声明错误，已在 live 配置里更正，见文末）：

**缺陷 1：RM2 按文件名归并。** `pathTokens()`（`plugin/scripts/design-evolution-readings.ts:487`）对每个路径只保留最后一段（`split("/").pop()`），于是不同目录下的同名文件会被算成同一个。同一根源还导致 worker-driver.ts 的 `observedPaths` 混入 `///home/yale/work/quay-worktrees/gap-ac144-quality-gate-shape-separated-driver/plugin/scripts/worker-driver.ts` 等 worktree 绝对路径（实测前 4 条全是这种形态），没有归一为仓库相对路径。按文件名作键的读数会把 `index.ts`、同名测试文件这类不相干的文件合在一起，与「外部可核直接量」的要求不符。

**缺陷 2：形态 2 有计数、无出处。** `quay-init-closure-ratchet.baseline.json` 的形态 2 计数为 4，但 `observedPaths` 为空；载体中实有 8 处 `Merge conflict in docs/analysis/quay-init-closure-ratchet.baseline.json`（按记录去重为 4，计数本身合理）。出处只为形态 1 记录了，形态 2 的计数没有可回溯的路径——一个读者无法从记录本身核对它数的是哪个文件（硬规则 3b 的同形风险）。

**缺陷 3：RM1 的搬家展示会被「拆成多次提交」绕过。** `maxCentralChangeCommit` 只列 |centralΔ| 最大的一次提交。worker 窗口里它列出的是 3ad17ac26（centralΔ +450 / nonCentralΔ 0，真实增长），而 GOAL-909 把代码从 worker-driver.ts 搬进 worker-pool.ts 的两次提交没有出现：f19a95371（centralΔ −356 / nonCentralΔ +505）、024f9d7f2（−44 / +367）。每一次单独都不是最大，于是搬家没有被揭示。

**改法验证（立案当轮实测，按 git numstat 逐提交计算）**：规则「列出窗口内每一次 centralΔ < 0 且 nonCentralΔ > 0 的提交」不需要任何阈值，在上述三次提交上的结果是：f19a95371、024f9d7f2 命中，3ad17ac26 不命中。也就是说，它恰好抓住了两次搬家，并且没有误报那次真实增长。

## Plan

1. 路径身份：形态 1、形态 2 的命中都先归一为**仓库相对路径**（去掉 worktree 根前缀 `<…>/quay-worktrees/<task-id>/`、主检出根前缀与多余的前导斜杠），以仓库相对路径作键；`file` 字段改为仓库相对路径，basename 只作展示。无法归一的路径进入 `unresolvedPaths`，不并入任何键。
2. 出处：形态 2 与形态 1 同样记录 `observedPaths`（归一后的仓库相对路径），以及样本的任务 id 与时间。
3. RM1 新增 `oppositeSignCommits`：窗口内每一次 centralΔ < 0 且 nonCentralΔ > 0 的提交（sha、两侧 Δ、提交标题），全量列出，不设阈值；保留 `maxCentralChangeCommit` 原字段不变。
4. 测试放在 `plugin/test/design-evolution-readings.test.mjs`：同名不同目录的夹具必须分成两个键；worktree 绝对路径与仓库相对路径必须归为同一个键；形态 2 计数必须带非空出处。

## Acceptance Criteria

- [ ] AC1 路径身份（真实载体）：对主检出真实的 `.quay/worker-outcome.jsonl` 运行一次，worker-driver.ts 那一项的键为 `plugin/scripts/worker-driver.ts`，其 `observedPaths` 中不再出现任何 `quay-worktrees/` 或以 `/` 开头的路径；贴出该项原文。
- [ ] AC2 同名不同目录分键（夹具负对照）：夹具里两个不同目录下的同名文件各有一次形态 2 冲突，读数必须是两个键、各计 1；把归一逻辑改回只取文件名时，该测试必须失败。贴出两次输出。
- [ ] AC3 形态 2 有出处：真实载体上 `docs/analysis/quay-init-closure-ratchet.baseline.json` 一项的 `observedPaths` 非空，且包含该仓库相对路径；贴出该项原文。
- [ ] AC4 搬家可见（真实历史）：对 worker 子系统（baseline 2440b52d0，head HEAD，中心文件 worker-driver.ts + worker-fan-in.ts，modules 为 `plugin/scripts/` 下文件名含 worker / pool / dispatch / fan-in 的 .ts）运行，`oppositeSignCommits` 包含 f19a95371 与 024f9d7f2，且不包含 3ad17ac26；贴出该字段原文。

## Definition of Done

- [ ] 四条 AC 全绿；`scripts/test.sh` 相关泳道通过；合并进 develop。
- [ ] 读数验证使用真实载体与真实 git 历史；夹具只用于 AC2 的分键负对照。
- [ ] `.quay/design-evolution-history.jsonl` 的记录形状只做向后兼容的新增（新增字段，不删、不改现有字段名），以免截断已有的读数史。

## 附：已在 live 配置中更正的声明错误（不属于本任务范围，记录在此便于核对）

首条生产记录里还有两处偏差来自配置声明，而非例程代码，已于 2026-10-22 在主检出 `.quay/config.yml`（不入库）中更正，下一次 quality 驱动重启后生效：

- serve 的 `modules` 只写了 HEAD 端 `packages/quay/src/serve/*.ts`，基线端位于 `src/` 根的 serve 族文件未被匹配，整族被算成新增：nonCentralΔ 读成 15491（应为 11872），占比 0.98%（应为 1.27%）。更正为两端 glob。
- worker 的窗口从 2440b52d0 直到 HEAD，跨过了 GOAL-909 的搬家提交，读成 69.97%。拆成两个条目：`worker-history`（head 钉在 GOAL-909 动手前的 ff32d031d，读数 82.46%）与 `worker-post-909`（baseline 024f9d7f2，当前为 `non-positive-denominator` 未评估——GOAL-909 之后 worker 文件尚无新增量）。

## Touches

- tasks/gap-design-evolution-readings-path-identity-and-split-move.md
- plugin/scripts/design-evolution-readings.ts
- plugin/test/design-evolution-readings.test.mjs
