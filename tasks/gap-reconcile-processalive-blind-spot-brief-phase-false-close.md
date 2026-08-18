---
id: gap-reconcile-processalive-blind-spot-brief-phase-false-close
title: "reconcile processAlive(runId) 盲区——impl subagent 未 fork worktree 的 brief 相被判「worktree-gone-and-no-process」误关 bracket"
status: todo
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

`fast-mode-telemetry.ts` 的 `makeDefaultExecutorGone`（`--reconcile` 的在飞判定）四级判断 `processAlive → worktreeExists → isBranchMerged → close`，其中 `processAlive(runId)`（:186）把 runId 拆成末两段 needle（如 `1787057856463-sb04tg`）扫 `/proc/*/cmdline`。但 impl subagent 是 Agent 工具派发，其进程 cmdline 不含 runId（runId 是遥测标识，不是进程标识）。于是 brief 相（subagent 已起、worktree 尚未 fork）下：process 查不到 + worktree 不存在 → 落到「worktree-gone-and-no-process」→ **误关 bracket**。

实证（2026-08-18 13:1xZ）：inner 跑 `--reconcile` 误关 closure-skips-task-end + git-history-counts-stale 两条在飞 bracket（其 impl agent 13:14 mtime 仍活跃、worktree 随后 fork 于 87f767ad）。`detectClosedButLive`（reverse 方向，gap-closed-bracket-leaves-live-agent-consuming-slots）随后把两条 catch 成 closed-but-live → `occupied_slots` 仍正确（无过度派发）。**但残留**：end 时间戳写早（duration 测量被污染）+ `closed_brackets_reflect_processes=false` 持续报红直到 fan-in 移除 worktree。

## Acceptance Criteria

- [ ] AC1: `--reconcile` 的 executor-gone 判定补上 subagent 活性信号（或修正 `processAlive` 的 runId 盲区），使 brief 相（agent 活、worktree 未 fork）的在飞 bracket 被判 KEEP 而非 close。
- [ ] AC2: 负控制——一个 brief 相（有活 impl agent、无 worktree）的 bracket 跑 `--reconcile`，结果 kept（不 close）、无 closed-but-live 残留。
- [ ] AC3: 该场景下 `closed_brackets_reflect_processes` 恢复 true（无误关导致的 false 信号）。

## Definition of Done

- [ ] 构造 brief 相在飞 bracket（活 agent + 无 worktree）跑 `--reconcile`，bracket 保持 kept、`closed_brackets_reflect_processes=true`、无 closed-but-live 残留（真实输出，非 fixture）。

## Touches

- tasks/gap-reconcile-processalive-blind-spot-brief-phase-false-close.md（自身）
- plugin/scripts/fast-mode-telemetry.ts（makeDefaultExecutorGone / processAlive 修复）
- plugin/test/fast-mode-telemetry.test.mjs（brief 相负控制测试）
