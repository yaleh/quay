---
id: gap-stranded-check-compares-against-master-not-landing-ref
title: task-status-drift-check --stranded 硬编码 master 当落点 — 两条线模型下全部 1900-2600
  commits-ahead 是 merge-base 漂移假象
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Finding

`task-status-drift-check.ts --stranded` 段硬编码 `master` 当落点（`:584` Gate 1 `git merge-base --is-ancestor <b> master`、`:622` `git log --merges master`），而 master 自 2026-08-06 停摆、`integration` 领先它 2601 提交。**两条线模型下 work 落在 integration，develop 只经 batch-merge 前进，master 停滞**——所以所有已 fan-in 到 integration 的 `task/*` 分支都被报成「commits ahead of master」的 stranded。

## 实测（2026-08-12 恢复期 outer 独立核实，全部跑过命令）

| 量 | 值 |
|---|---|
| `master..integration` | **2601** |
| `master..task/gap-suite-leaks-live-claude-sessions` | 2593（工具报的数） |
| `integration..task/gap-suite-leaks-live-claude-sessions` | **0** |
| branch 是否 integration 祖先 | **YES** |
| `integration..master` | 0（master 无 integration 之外提交，纯停滞） |
| 工具报 stranded 总数 | 39 |

spot-check 三条同批：
- `task/gap-a15-ruling5-counter-missing`：int..branch=**0** 却报 2066 ahead（全假）
- `task/gap-chart2-s2-...`：int..branch=**0** 却报 489 ahead（全假）
- `task/gap-send-keys-verified-hash-check-...`：int..branch=**1**（真 stranded，唯一一条）

**2593 是「领先 master」，不是「领先 integration」**。这是工具 merge-base 漂移（stranded 段未跟上 `gap-git-history-landed-master-stale-under-two-line-model` 已修过的 landingRef 逻辑——`:359-376` 的 `landingRef()` 正确用 integration→develop→master，但 stranded 段没用它）。

## 修复方向（outer 裁定 → inner 实现）

stranded 段的 Gate 1/Gate 2 改用 `landingRef()`（integration→develop→master 首个存在者），与同文件 landing-evidence 段 `:434/:466` 一致；`_mergeAddedMissing` 的 `git log master` 同步改 landingRef。

## AC

- [x] 复现固化——任务体记录 39 条 stranded 中 38 条是 master-lag 假象的实测（master..integration=2601 vs integration..branch=0）
- [x] stranded 段用 landingRef() 而非硬编码 master（`classifyBranch`/`_mergeAddedMissing`/`_shortstatInsertions`/`entriesInBranchDiff`/`strandedBranches`/`scanTasks` 全部贯通 landing）
- [x] 修后实跑：gap-suite-leaks / gap-a15-ruling5 报不再 stranded；gap-send-keys-verified 仍报（真 stranded 保留）——**39 → 4**（剩余 4 条全真：M239 legacy、self-hosting 保留分支、semantic-observer reverted、send-keys-verified）
- [x] 既有 stranded 相关测试不回归（51/51 绿，含镜像一致性 AC1）

## DoD

- [ ] 修后 `--stranded` 报数从 39 降到真实值（≤1 条真 stranded）——已降到 4（含 3 条真 stranded + 1 legacy）；外层 verification-round 复核
- [ ] 全量套件绿（fail 0 且 cancelled 0）（外层 verification-round 验证）

## Touches

- plugin/scripts/task-status-drift-check.ts（stranded 段 Gate 1/Gate 2 用 landingRef()）
- experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts（镜像，AC1 字节一致）
- plugin/test/task-status-drift-check.test.mjs（既有，不回归）
- tasks/gap-stranded-check-compares-against-master-not-landing-ref.md（自身：勾 AC + 贴证据）

## Evidence（inner 2026-08-12）

**改动**：`task-status-drift-check.ts` 全部 6 处硬编码 master 改为 landingRef 贯通：
- `classifyBranch(repoRoot, branch, landing = "master")`：Gate 1 `merge-base --is-ancestor branch landing`、commits ahead `rev-list --count branch --not landing`、Gate 2 first-parent `rev-list --first-parent landing`
- `_mergeAddedMissing(repoRoot, tipSha, landing)`：`log --merges landing` + `cat-file -e landing:<f>`
- `_shortstatInsertions(repoRoot, branch, landing)`：`diff landing...branch`
- `entriesInBranchDiff(repoRoot, entries, branch, landing)`：`diff landing...branch`
- `strandedBranches(repoRoot, opts)`：`const landing = landingRef(repoRoot, opts)` 传入 classifyBranch
- `scanTasks`：接收 `landing` 传 entriesInBranchDiff
- main `--stranded`：`const landing = landingRef(repoRoot)`
- experiments 镜像同步（AC1 字节一致）

**验证读数**：
1. `--stranded`：**39 → 4**（gap-suite-leaks/a15-ruling5/chart2 全清除；send-keys-verified 仍报 1 ahead 真 stranded；M239 legacy + self-hosting 保留分支 + semantic-observer reverted 真保留）
2. `task-status-drift-check.test.mjs`：**51/51 绿**（含 AC1 experiments/plugin 镜像字节一致 + stranded 负控制 + entriesInBranchDiff divergent-diff 用例）
3. `--for-task` scoped 门：全绿（隔离违规 0、task-contract 无违规）