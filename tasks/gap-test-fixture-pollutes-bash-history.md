---
id: gap-test-fixture-pollutes-bash-history
title: 测试 fixture 污染真实 ~/.bash_history（isolateTmuxEnv 未隔离 HISTFILE）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：用户发现 + manager 核实投递（测试 fixture 卫生问题，⛔ 与 *-driver 架构无关——`grep send-keys|isolateTmuxEnv|TMUX_TMPDIR promotion-driver-launch.sh worker-driver.ts` 零命中，production driver 从不用这机制）。

**现象（实测）**：`~/.bash_history` 共 2000 行，其中 **1679 条 `claude-probe`**（84% 是 fixture 噪音）——大量 `exec -a claude-probe sleep 10000 &` 及变体。

**根因**：`plugin/test/session-liveness-helpers.mjs` 的 `isolateTmuxEnv(sockDir)`（:378）只设 `TMUX_TMPDIR`（隔离 tmux socket）+ `delete env.TMUX`，**没碰 `HOME`/`HISTFILE`**。`makeEnvProbe`/`makeNoEnvProbe` 用它起的 `tmux new-session -d … "bash"` 是真交互式 shell、继承真实 `$HOME`，`send-keys` 发的 `exec -a claude-probe sleep 10000 &` 被这个 bash 记进真实 `~/.bash_history`。

**修法（单点，⛔ 不逐文件打补丁）**：`isolateTmuxEnv` 返回的 env 加 `HISTFILE=/dev/null`（或指向 tmp 目录内的隔离路径，与既有 `TMUX_TMPDIR` 隔离同款手法）——`grep -rl isolateTmuxEnv plugin/test/` 命中 **12 个测试文件**共用这个 helper，单点修复传播到全部 12 个消费者。

## Plan

1. `isolateTmuxEnv` 返回 env 加 `HISTFILE` 隔离（`/dev/null` 或 tmp 隔离路径）。
2. 测试：跑一次用到该 helper 的测试后，真实 `~/.bash_history` 不变（跑前跑后 diff 空）。

## Acceptance Criteria

- [ ] AC1（能取假）：跑一次用到 `isolateTmuxEnv` 的测试后，真实 `~/.bash_history` 内容不变（跑前跑后 diff 为空）；⛔ 仍被记入 `claude-probe` ⇒ 假。

## Definition of Done

- [ ] `isolateTmuxEnv` 加 HISTFILE 隔离 + 真实 bash_history 不再被污染；AC1 全勾；land 到 develop。

## Retires

- 无

## Touches

- plugin/test/session-liveness-helpers.mjs（isolateTmuxEnv 加 HISTFILE 隔离，单点覆盖 12 消费者）
- plugin/test/session-liveness-restart.test.mjs（test：probe 跑后 bash_history 不变 / env 含 HISTFILE 隔离）
- tasks/gap-test-fixture-pollutes-bash-history.md（自身）
