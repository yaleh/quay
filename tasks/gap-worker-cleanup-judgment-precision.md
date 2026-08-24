---
id: gap-worker-cleanup-judgment-precision
title: 清理判据精确化：清理前 git log 判有无产出 + failed 按信号区分（SIGTERM vs 自崩）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

清理判据现为**纯终态字符串布尔判断**，无「这个 worktree 里有没有价值」的检查；且 `failed` 桶混两类：`exit_code=143`(SIGTERM，外部杀——可能是 driver 重启误伤，worker 正干着活被打断，worktree 很可能有价值) 与「worker 自崩」。历史分布（139 条）：failed 仅 2 条（同一任务、exit_code=143、0.7min/4.2min 启动阶段被杀，worktree 大概率无价值）。

## Plan

两个子点：①清理前查 `git log develop..task/<id>`（直接量、可取假）：零提交 ⇒ 无产出可清；有提交 ⇒ 有实现保留。②`failed` 按信号区分：SIGTERM（外部杀）vs 自崩，前者有提交则保留。

## Acceptance Criteria

- [ ] AC1（能取假，git log 判产出）：清理前查 `git log develop..task/<id>`，零提交 ⇒ 清、有提交 ⇒ 保留（⛔ 纯终态名判断、不看提交 ⇒ 假）。
- [ ] AC2（能取假，信号区分）：`failed` 中 exit_code=143(SIGTERM) 有提交者保留（⛔ SIGTERM 有提交仍被清 ⇒ 假）。

## Definition of Done

清理判据精确化落地 develop；AC1-2 全勾；一个零提交的 failed worktree 被清（AC1）、一个 SIGTERM 有提交的 worktree 被保留（AC2）。

## Touches

- plugin/scripts/worker-driver.ts（cleanupOrphanWorktree 加 git log 判产出 + failed 按 signal 区分）
- plugin/test/worker-driver.test.mjs
- tasks/gap-worker-cleanup-judgment-precision.md（自身）