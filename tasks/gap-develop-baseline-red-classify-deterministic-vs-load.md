---
id: gap-develop-baseline-red-classify-deterministic-vs-load
title: develop 基线红分类：近 8 轮 60 个基线红文件逐个单独跑两遍，分确定性红 / 隔离绿 / 不稳定，确定性红立修复任务
status: done
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

- [x] AC1: `docs/evidence/2026-10-15-develop-baseline-red-classification.md` 含：取数命令与原始并集（应为 60 个文件或说明差异）、develop tip commit、每个文件两遍单独运行的退出码与耗时。
- [x] AC2: 证据文档给出三类分类表，每个文件恰属一类，并附判定规则原文。
- [x] AC3: 每个「确定性红」文件都对应一条本任务板上的任务 id（新立或已有，注明查重结论）；若无确定性红，如实写明。

## Definition of Done

AC1–AC3 带真实读数勾选；本任务只做测量与立案，不改任何测试或产品代码。落地后观测（不在 worker 内）：确定性红修复任务全部落地、且 32G 上限生效后，再取最近 8 轮基线红并集，与本文档对比条数变化。

## Touches

- docs/evidence/2026-10-15-develop-baseline-red-classification.md
- tasks/gap-develop-baseline-red-classify-deterministic-vs-load.md

## Evidence

**读数（全部落在 `docs/evidence/2026-10-15-develop-baseline-red-classification.md`，每个数字由生成器从原始载体直接算出）**

- 取数：`.quay/baseline-red-rounds.jsonl` 最近 8 轮 `blocked` **去重并集 = 60 个文件**，与 Proposal 逐字一致；ts 区间一致。
- 测量：develop tip `dae398dd7` 的专用 worktree，逐文件 `node --test` 两遍、顺序执行（120 趟）
  ⇒ **确定性红 0 / 隔离绿 59 / 不稳定 1**（三类之和 = 60，每行恰属一类）。
- **round B（换树复核，§3b）**：`git merge develop` 之后在同一棵 worktree 上原样重跑同一套 120 趟
  （测得的树 `84bf0429b`，develop 内容基线 `8fea2373`）⇒ **逐文件类别与 round A 全部 60 个一致**：
  确定性红 0 / 隔离绿 59 / 不稳定 1，且不稳定的仍是同一个文件。⇒ 「0 确定性红」不是某一棵树的偶然。
- fidelity：worktree provisioning 只拷 `plugin/vendor/*/dist`、**不建 `packages/*/dist`** ⇒ `QUAY_CLI` 退化为 `.ts` 回退（与真套件不同形）⇒ 补跑 `scripts/test.sh` 的 `build_dist_once` 并**作废首轮重跑**（非中途改口径）。
- 仪器正控：必然红的控制文件跑出 `exit 1` + `# fail 1` ⇒ 「0 红」是**测出来的**，不是默认值。
- 唯一的不稳定文件 `plugin/test/driver-restart-busy-e2e.test.mjs`（§5b，6 趟）：**3 绿 3 红**，红点是
  **`AC2a-real`×2 与 `AC2b`×1** ⇒ **红点会移动**（同一份夹具、不同用例在不同趟次输掉同一场竞速），
  失败文案统一为 `timed out waiting for the dispatched fixture worker to appear`（**墙钟等待**，非断言值算错）。
  ⛔ 已写明 `/proc` 进程数与本条红**不是单调对应**，不把相关性说成成因。
  （本条**修正**了本文件早先的一句「红点始终是同一条用例」——round B 把它证伪了，故按实测改写。）

**AC3 的答案**：本任务板上**无需新立修复任务**——两轮共 240 趟里没有任何文件判为「确定性红」，文档 §5 如实写明，并给出机制解释：载体 `blocked` 的语义是「task 树红了、develop 基线树重跑没红」（`worker-fan-in.ts:1345-1359` + `:3123-3127`），而一个在 develop 上确定性红的文件在 A/B 里两趟都会红 ⇒ 走 `exempt` ⇒ **结构性不会进入该载体**。文档同时列出内存/并发方向的既有归属任务，使「0 确定性红」这个结论可执行。

**验证（worktree 内）**：scoped 门 `bash scripts/test.sh --for-task gap-develop-baseline-red-classify-deterministic-vs-load --allow-thin` ⇒ **exit 0**（selector selected 0 test files, thin allowed——Touches 是证据文档 + 任务自身，无可选测试）；`anti-drift-touches-check.ts --merge-target develop` ⇒ **OK, 1 actual file(s), all within declared Touches**；pre-commit 守卫通过。
