---
id: gap-develop-baseline-red-classify-deterministic-vs-load
title: develop 基线红分类：近 8 轮 60 个基线红文件逐个单独跑两遍，分确定性红 / 隔离绿 / 不稳定，确定性红立修复任务
status: todo
labels:
  - gap
parent: null
children: []
extra: {}
---
## Proposal

**问题**：develop 基线本身不绿且不稳定，机械 fan-in 的「任务红集 ⊆ 基线红集」A/B 判定因此反复把负载噪声判成任务引入的红（本地近 ~60 轮 worker 结局里 22 轮红在 suite、24 轮落地）。

**真实读数（`.quay/baseline-red-rounds.jsonl` 最近 8 轮，ts 1791911094183–1791995508088）**：并集 **60 个文件**，每轮集合不同。出现频次最高：`plugin/test/full-suite-runner-s07` / `-cgroup` / `-phases`（6/8）；`full-suite-runner-s12` / `-s10`、`worker-driver`、`supervisor-observe`、`packages/quay/test/serve-ac95-views`（5/8）；`live-web-address`、`shipped-shell-reachability`（4/8）；`full-suite-runner-s06/-s02/-s08/-s05`、`trend-check`、`build-plugin-dist`（3/8）；其余 2/8 或 1/8。⇒ 套件运行器自身的测试是最常见的基线红。

**人 2026-10-15 裁定**：套件 MemoryMax 可放大到 32G（不做主机级治理）；主检出 `.quay/config.yml` 已声明 `suite: memory_max: 26G`（当前护栏值，按声明值生效）。

**方案**：在 develop 当前 tip 的专用 worktree 上，把上面 60 个文件**逐个单独**跑两遍（顺序执行，不并发），按结果分三类：
- 确定性红：两遍单独都红 ⇒ 真代码/夹具缺陷；
- 隔离绿：两遍单独都绿 ⇒ 只在全量时红（资源/负载/交互），交给内存与并发方向；
- 不稳定：两遍结果不一致。
对每个确定性红文件，查重后在本任务板立（或指向已有的）修复任务。

## Plan

1. 从 `.quay/baseline-red-rounds.jsonl` 取最近 8 轮 `blocked` 的文件并集（脚本化，读数原样进证据）。
2. develop tip 的专用 worktree，逐文件 `node --test <file>` 两遍，记录退出码、耗时、失败用例名。
3. 写证据文档与分类表；为确定性红查重立案。

## Acceptance Criteria

- [ ] AC1: `docs/evidence/2026-10-15-develop-baseline-red-classification.md` 含：取数命令与原始并集（应为 60 个文件或说明差异）、develop tip commit、每个文件两遍单独运行的退出码与耗时。
- [ ] AC2: 证据文档给出三类分类表，每个文件恰属一类，并附判定规则原文。
- [ ] AC3: 每个「确定性红」文件都对应一条本任务板上的任务 id（新立或已有，注明查重结论）；若无确定性红，如实写明。

## Definition of Done

AC1–AC3 带真实读数勾选；本任务只做测量与立案，不改任何测试或产品代码。落地后观测（不在 worker 内）：确定性红修复任务全部落地、且 32G 上限生效后，再取最近 8 轮基线红并集，与本文档对比条数变化。

## Touches

- docs/evidence/2026-10-15-develop-baseline-red-classification.md
- tasks/gap-develop-baseline-red-classify-deterministic-vs-load.md
