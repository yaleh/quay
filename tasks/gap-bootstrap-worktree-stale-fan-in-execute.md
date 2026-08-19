---
id: gap-bootstrap-worktree-stale-fan-in-execute
title: "bootstrap worktree scriptPath 用陈旧 fan-in-execute.js——poll-bounded fix 对 bootstrap-HIT 任务不生效"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

bootstrap 机制（任务 touches fan-in 编排文件 ⇒ fan-in 用 worktree scriptPath）会让 fan-in 用【worktree 的陈旧 fan-in-execute.js】，而 worktree fork 早于某些 fan-in 编排修复的 land ⇒ 修复对 bootstrap-HIT 任务【不生效】。

实证（2026-08-19）：full-suite-state-stale 是 bootstrap-HIT（touches fan-in 编排），其 worktree 在 e29e5de9 fork（早于 poll-bounded 23a75eba land），所以 worktree 的 fan-in-execute.js 是【旧版】——poll 命令还是旧的立即返回（非 `timeout 540` 阻塞），poll-bounded 的「有界阻塞等待」对 bootstrap-HIT 任务【不生效】。功能正确性不受影响（非阻塞 poll 多 ~21 次往返），但 DoD「~3 次」在生产没实现。

## Acceptance Criteria

- [ ] AC1: bootstrap 机制的 worktree scriptPath 在 merge develop 前【先同步 fan-in-execute.js 到 worktree】（或改为 main scriptPath + 显式 worktree 参数），确保 worktree 用最新编排文件。
- [ ] AC2: 负控制落在生产载体——一个 bootstrap-HIT 任务的 fan-in，poll 命令确为最新版（含 timeout 540 阻塞），轮询次数 ~3 次（读生产 journal，非 fixture）。
- [ ] AC3: scoped 绿 + bootstrap 相关测试不红。

## Definition of Done

- [ ] bootstrap-HIT 任务的 fan-in 用最新编排文件，poll-bounded 的「~3 次」生效（真实输出）。

## Touches

- tasks/gap-bootstrap-worktree-stale-fan-in-execute.md（自身）
- plugin/scripts/（bootstrap 机制：worktree scriptPath 同步 fan-in-execute.js，或改 main scriptPath）
- plugin/test/（bootstrap-HIT 负控制）
