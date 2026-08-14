---
id: gap-session-liveness-fixture-tmux-not-killed
title: session-liveness hermetic 夹具创建 tmux server 从不 kill——sweepTmp 因 dirHasLiveOwner 保护活 owner 而跳过，泄漏 6 个 29h tmux（manager 15:2xZ 报）
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

**（session-liveness hermetic 夹具泄漏 tmux server——manager 2026-08-14 15:2xZ 报，outer 核实）**。

**现场（outer 按位置核实）**：
```
/tmp/session-liveness-*/ 目录 6 个 · tmux server 进程 6 个存活 29.1-29.2h
socket 名：sig-k-omDepW / sig-i-P6M8z4 / hb-OxX5o3 / sig-k-3pCXft / hb-ufSPi9 / sig-i-iHSwXs
⇒ sig-k/sig-i/hb = 测试用例名（signals-kinds/signals-integration/heartbeat）⇒ hermetic 夹具跑完没 kill tmux
```
**与 CLAUDE.md 已记同族**（/tmp 积压 3389 目录/1.1G），但**这是长驻进程不只是目录**。

**根因（机械）**：夹具用 `isolateTmuxEnv/newHermetic` 起 `tmux -S /tmp/session-liveness-*/sock/... new-session`（hermetic 探针），
**after() 只 sweepTmp 目录、不 kill tmux server**；而 `sweepTmp` 的 AC3 owner-liveness 判据（sweep.test.mjs:20「跳过 owner 活着的目录」）
**正确保护活 owner** ⇒ 泄漏的 tmux 让目录永久存活 ⇒ sweep 永远跳过 ⇒ **泄漏无出口**。

**⚠️ 与已 done 的 `gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause` 的关系**：那条治的是三次崩溃的主泄漏（已清）；**本条是它的子形态**——hermetic 夹具的 tmux 没被 kill，sweep 的 owner 保护让这类泄漏无出口。**分开立**（不同根：那条是清理路径缺失，本条是夹具 after() 不 kill + sweep owner 保护交互）。

**判据1**：session-liveness 测试的 after() **kill 自己创建的 tmux server**（不是只 sweepTmp 目录）——`tmux -S <socket> kill-server` 在 after() 清理。
**判据2（能取假·真样本不构造）**：**无测试运行时 `/tmp/session-liveness-*` 目录数应为 0**——现 6（真样本回放红）；修复后跑一遍相关测试，跑完再数应回到 0（负控制）。
**判据3**：sweepTmp 的 owner-liveness 保护**保留**（不因本条削弱——防误杀活监视器是它存在的意义）；本条修的是【夹具侧不 kill】不是【sweep 侧不保护】。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**不覆盖**：不削弱 sweepTmp owner-liveness（AC3 安全属性）；不改真监视器清理路径（monitor 2729903 是活的，正确存活）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 session-liveness 测试的 after()（signals-kinds/signals-integration/heartbeat 的 sweepTmp 调用）+ isolateTmuxEnv/newHermetic 的 tmux 创建。
2. 判据1：after() 加 kill-server（自己创建的 tmux）。
3. 判据2 能取假：无测试运行 /tmp 目录数应 0；修复后跑完回 0。
4. 判据3：sweepTmp owner-liveness 保护保留。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：夹具 after() kill 自己创建的 tmux server。
- [ ] AC2 判据2 能取假：无测试运行 /tmp 目录数 0（真样本 6 回放红）。
- [ ] AC3 判据3：sweepTmp owner-liveness 保护保留。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] session-liveness 夹具 kill 自己的 tmux + 无测试运行时 /tmp 目录 0 + owner-liveness 保护不削弱。

## Touches

- plugin/test/session-liveness-signals-kinds.test.mjs（after() 加 kill-server）
- plugin/test/session-liveness-signals-integration.test.mjs（after() 加 kill-server）
- plugin/test/session-liveness-heartbeat.test.mjs（after() 加 kill-server）
- plugin/test/session-liveness-helpers.mjs（若 isolateTmuxEnv 需返回清理句柄）
- tasks/gap-session-liveness-fixture-tmux-not-killed.md（自身）

## Evidence

（落地后回填——outer 2026-08-14 15:2xZ 已清理 6 个泄漏 tmux：kill 后 tmux 计数 10→4、真监视器 2729903 存活 1d2h）
