---
id: gap-goal033-selfhost-and-archguard-evidence
title: GOAL-033 ②：ArchGuard before/after（cli 离开 package SCC 6→5）+ 负对照 + CLI 语义现场重算
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal033-driver-control-and-vocab-to-core
goal_ac: AC-351
---
**type:** execution

## Proposal

GOAL-033 的第二块（分支自举 + ArchGuard before/after）：在实现已进入 `goal/GOAL-033` 之后，用**同一个 ArchGuard 构建**对 fork point 与分支 tip 各做一次单根分析，产出 AC-351 读取的证据文件，并附一个**可证伪的负对照**——证明「`cli` 离开 package SCC」这个读数不是恒真的。

为什么要单独一块：AC-350 只看源码层（grep 按位置判定 + 两个仓内检查器），它证明「边没了」；但 GOAL-033 的目标陈述是「目录环缩小」，那是 ArchGuard 的 package 级 SCC 读数，属于另一个仪器、另一个层面。两者都要有，且 SCC 读数必须能取假，否则它只是「与成功同形」的回声（硬规则 4）。

已知 before 读数（调查时取，scope `26b300e9`，develop `1025ab951`，与 fork point `1ac06fd85` 的 `packages/quay/src` 逐字相同）：`detect_cycles(outputScope:"package")` ⇒ 恰好 1 个 SCC，成员 `["", "cli", "fan-in", "gate", "gate/config", "gate/factories"]`；`get_package_metrics(packageName:"cli")` ⇒ `fanIn: 2`。本任务要在 fork point 上**重新取一次**（不抄调查读数），确认可复现。

## Plan

1. **记录 ArchGuard 版本**：before 与 after 必须是同一个构建；把版本串写进证据（`archguardVersion`）。若会话中 ArchGuard 版本变化，两次都重取。
2. **before（fork point）**：`git worktree add --detach /home/yale/work/quay-worktrees/goal033-fork 1ac06fd85`（⛔ 不放 `/tmp`）。对它跑 `archguard_analyze(projectRoot=<该 worktree>, sources:["packages/quay/src"], lang:"typescript", format:"json")`，**显式传回显的 scope key**（⛔ 不省略 scope——省略时会静默选中一个陈旧的无关 scope），再跑 `archguard_detect_cycles(outputScope:"package", scope:<key>)` 与 `archguard_get_package_metrics(packageName:"cli", scope:<key>)`。读完 `git worktree remove` 掉它。
3. **after（分支 tip）**：在本任务 worktree（已含实现）上做同样三步。期望 `cli.fanIn = 0`，SCC 成员恰为 `["", "fan-in", "gate", "gate/config", "gate/factories"]`——**其余五员不多不少**，证明本 goal 没碰别的边、也没造出新边。
4. **负对照**：把本 worktree 的 `packages/quay/src` 复制到一个 scratch 目录（`/home/yale/work/quay-worktrees/goal033-negctl/`），只在副本的 `serve-sessions.ts` 顶部注入一行 `import { handleDriver } from "./cli/driver.ts";`（选一个搬迁后仍存在的导出），对副本跑同样三步 ⇒ 期望 `cli.fanIn ≥ 1` 且 SCC 重新包含 `cli`。读完删掉 scratch 目录。
5. **落盘证据** `.quay/goal-033-evidence/archguard-before-after.json`（**要 `git add -f` 提交**，否则 goal 判据 worktree 读不到——GOAL-032 的同名证据就是这样进去的）：
   `{ archguardVersion, before: {treeSha, scopeKey, packageSccMembers, packageSccSize, cliPackageFanIn, packageSccContainsCli}, after: {...同上}, negativeControl: {injected, cliPackageFanIn, packageSccContainsCli, packageSccMembers}, consumerConvergence: [{file, importLine}...] }`。`consumerConvergence` 用 grep 的真实行文本（`serve-sessions.ts`、`serve.ts`、`cli/server.ts`、`cli/driver.ts`、`cli/help.ts` 五个文件各一条），不是推断。
6. **三层分开记录**（⛔ 不合成一张表）：facts（上面的 ArchGuard 原始读数）/ declared rules（`import-graph-check.ts` 与 `enum-surface-parity-check.ts` 的 pass/fail——这两个是确定性检查，不是语义判断）/ judgment（对「这是 ownership 真迁移、不是搬壳」的结论，必须引用第一块里「注入 root→fan-in 边会被判据抓到」的负对照）。可选跑一次 `archguard:arch-layer-review` skill 做 before/after 语义复核，⛔ 不作硬性要求，若跑了把它的四态结论原样记下。
7. **自查**：在本任务 worktree 内跑 AC-351 判据（它会在被求值树上**现场**跑 `quay driver status --kind worker|promotion --json`，不读证据里的自报），exit 0 才算完。

## Acceptance Criteria

- [ ] `.quay/goal-033-evidence/archguard-before-after.json` 已提交到本任务分支，且 before / after / negativeControl 三段都由同一 `archguardVersion` 取得、每段带显式 `scopeKey`
- [ ] before 段复现调查读数：SCC 成员 6 个含 `cli`、`cliPackageFanIn = 2`
- [ ] after 段：`cliPackageFanIn = 0`，SCC 成员恰为 `["", "fan-in", "gate", "gate/config", "gate/factories"]`
- [ ] negativeControl 段：注入一条 core→cli 边后 `cliPackageFanIn ≥ 1` 且 SCC 重新包含 `cli`
- [ ] AC-351 判据在本任务 worktree 内 exit 0，输出原文进 `## Evidence`
- [ ] Evidence 里 facts / declared rules / judgment 三段分开记录
- [ ] 临时 worktree `goal033-fork` 与 scratch 目录 `goal033-negctl` 已清理（`git worktree list` 读数进 Evidence）

## Definition of Done

AC-351 的证据文件在分支上可读，三段读数出自同一 ArchGuard 构建且显式 scope；`cli` 离开 package SCC、其余五员不变、负对照把它拉回——读数能取假；AC-351 判据（含现场重算的 CLI 语义探针）在分支树上 exit 0；临时产物已清理。

## Touches

- .quay/goal-033-evidence/archguard-before-after.json
- tasks/gap-goal033-selfhost-and-archguard-evidence.md
