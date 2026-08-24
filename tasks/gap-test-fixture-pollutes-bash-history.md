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

**修法**：给 fixture 的 tmux bash pane 构造 env 的每个 `isolateTmuxEnv` 拷贝加 `HISTFILE=/dev/null`（与既有 `TMUX_TMPDIR` 隔离同款手法）。⚠️ **原「单点」前提不成立**（`grep -rl` 只数名字、未验证是否共用同一 helper）：12 个命中文件里只有 **8 个 `import` 共享 helper**（`session-liveness-helpers.mjs`）；**3 个文件自带本地副本**（`inner-session-check` / `session-topology` / `quay-init-tmux-detection`，各自 `new-session … "bash"` + `send-keys "exec -a claude-probe …"` 污染），`session-liveness-events` 另有 **2 处内联 `{...process.env, TMUX_TMPDIR: sockDir}`** 拷贝（未走已 import 的 helper）。故需 共享 helper + 3 本地副本 + 2 内联（改为调已 import 的 helper）一并修，否则「真实 bash_history 不再被污染」不成立。

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

- plugin/test/session-liveness-helpers.mjs（共享 isolateTmuxEnv 加 HISTFILE 隔离，覆盖 8 个 import 消费者）
- plugin/test/inner-session-check.test.mjs（本地 isolateTmuxEnv 副本加 HISTFILE）
- plugin/test/session-topology.test.mjs（本地 isolateTmuxEnv 副本加 HISTFILE）
- plugin/test/quay-init-tmux-detection.test.mjs（本地 isolateTmuxEnv 副本加 HISTFILE）
- plugin/test/session-liveness-events.test.mjs（2 处内联 env 拷贝改用已 import 的 isolateTmuxEnv）
- plugin/test/session-liveness-restart.test.mjs（test：R7 env 含 HISTFILE 隔离 / R8 probe 跑后 bash_history 不变）
- tasks/gap-test-fixture-pollutes-bash-history.md（自身）
