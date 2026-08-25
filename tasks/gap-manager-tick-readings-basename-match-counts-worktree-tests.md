---
id: gap-manager-tick-readings-basename-match-counts-worktree-tests
title: manager-tick-readings 按 basename 匹配 session-liveness.sh 无 root 过滤——worktree 测试进程被计成「已挂载监视器」，monitor.mounted 在真监视器死亡时仍报 true（硬规则 4b 代理量偏离）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/scripts/manager-tick-readings.ts:429-430` 数「已挂载监视器」时按 **basename** 匹配 `session-liveness.sh`、**无 root 过滤**（我读码复核，非采信）：
```js
if (path.basename(argv[1]) !== "session-liveness.sh") continue;   // 只比 basename
```
⇒ 任务 worktree 里被套件拉起的 `session-liveness.sh` 测试进程（`quay-worktrees/<task>/plugin/scripts/session-liveness.sh`）被计成「已挂载的监视器」。本轮 A0 报 `monitor.instances=3`，而 `monitor-mount-check.sh --json`（有 targetRoot 概念）报 **1**——两个口径的差由此有确切成因（非「读数抖动」）。

**真正危险的是方向相反的那半（`:523`）**：
```js
lines.push(`monitor.mounted ${monitors.length > 0}`);
```
⇒ **真监视器若死了，而任一任务的套件恰好在跑 session-liveness.sh，`monitor.mounted` 仍报 `true`**——硬规则 4b 的形态（一个在该报假时报真的读数；本来能取假、因中间隔了一层未经验证的 basename 过滤而不再反映实际）。

**严格区分（别混着用）**：
- **已观测**：虚高计数 **2 次**（上轮 3 报成 2、本轮真值 1 报成 3）；
- **仅结构推出、⛔ 未观测**：`mounted=true` 掩盖真监视器死亡——今日真监视器一直活着，此方向没发生过。

**与 `gap-monitor-mount-check-stale-pids` 非同一条**：那是 `monitor-mount-check.sh` 报死 pid（扫描后输出前无存活复验）；本条是 `manager-tick-readings.ts` 的 basename 匹配（不同脚本、不同成因）。

## Plan

`manager-tick-readings.ts` 的 monitor 扫描加 **root 过滤**：只认主检出（`repo_root`）下的 `session-liveness.sh`，worktree 路径（`quay-worktrees/`）排除。判据可锚在「读数报出的 monitor pid 集合 ⊆ 主检出下的 session-liveness.sh 集合」（能取假的形式），⛔ 不靠 basename 单独判。

## Acceptance Criteria

- [x] AC1（能取假，不误计 worktree 测试进程）：造一个 worktree 里的 `session-liveness.sh` 测试进程，`manager-tick-readings` 的 `monitor.instances` 不把它计入（root 过滤生效）；（⛔ 仍计入 ⇒ 假）。
- [x] AC2（能取假，mounted 不掩盖死亡）：真监视器死 + 某任务套件正在跑 `session-liveness.sh` 时，`monitor.mounted` 报 **false**；负控制：真监视器死 + 无测试进程 ⇒ 同样 false（对照证明过滤不是靠「无进程」侥幸）；（⛔ 真监视器死但测试进程在 ⇒ 仍 true ⇒ 假）。
- [x] AC3（能取假，不回归）：真监视器存活时 `monitor.mounted` 仍 true、`monitor.instances` 计数正确（不误杀真监视器）；（⛔ 真监视器被过滤掉 ⇒ 假）。

## Definition of Done

monitor 扫描加 root 过滤；AC1-AC3 全勾；worktree 测试进程不再污染计数、真监视器死亡不再被 mounted=true 掩盖。

## Evidence

- 实现：`plugin/scripts/manager-tick-readings.ts` 新增 `readCwd` / `resolveScriptPath` / `isMainCheckoutScript`（`repoRoot + path.sep` 前缀判定，`quay-worktrees/` 是兄弟目录不满足前缀），`monitorInstances(entryLastCommit, repoRoot, procRoot)` 加 root 过滤，`render` 传 `opts.repoRoot`。
- 测试（`plugin/test/manager-tick-readings.test.mjs`，`node --experimental-strip-types --test` 27/27 绿）：
  - `monitorInstances root-filter counts only main-checkout monitors (AC1 worktree + foreign-repo excluded)` —— pid 100（主检出）计入、300（/opt/quay 外仓）排除、400（worktree）排除 ⇒ instances=1。
  - `monitorInstances resolves relative argv[1] via /proc/<pid>/cwd` —— cwd=repoRoot 计入、cwd=worktree 排除；`isMainCheckoutScript` 前缀边界（`quay2` ≠ `quay/`）判 false。
  - `monitor.mounted false when only a worktree test process is running (AC2)` —— worktree 测试进程在 + 真监视器死 ⇒ `mounted false`；负控制：无进程 ⇒ 同样 false。
  - `monitor.mounted true and instances correct when a real main-checkout monitor is alive (AC3 no regression)` —— 真监视器存活 ⇒ `mounted true`、`instances 1`，混杂 worktree 进程 pid 400 不进 `monitor.instance`。

## Touches

- plugin/scripts/manager-tick-readings.ts（monitor 扫描 root 过滤 + mounted 判据）
- plugin/test/manager-tick-readings.test.mjs（worktree 测试进程负控制 + 真监视器死亡负控制 测试）
- tasks/gap-manager-tick-readings-basename-match-counts-worktree-tests.md（自身）
