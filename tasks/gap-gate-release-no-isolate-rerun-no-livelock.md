---
id: gap-gate-release-no-isolate-rerun-no-livelock
title: "gate load-sensitive release 无 C11 隔离重跑 + 无 anti-livelock 兜底——全量 relaunch 循环无界（收敛失败）"
status: ready
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`fix-scope gate` 的 load-sensitive release 语义不完整，有两个叠加缺口：

1. **release = 全量 relaunch 而非 C11 隔离重跑**：load-sensitive 族（real-install/nested-spawn/wall-clock）被判 out-of-scope 后，release 动作是「全量 suite relaunch」，而不是「隔离低并发重跑失败的测试」。在「高 load 常驻」（多 suite 并发）下，relaunch 不减 load，load-sensitive 族反复红 ⇒ 收敛失败（2026-08-19 ac101 fan-in 实证：3 RED + 3 relaunch，靠低 load 单飞侥幸收敛，不是机制修好）。

2. **release 侧无 anti-livelock 兜底**：anti-livelock（SPEC §7 attempt≥3）在 ff-merge 侧（inert-increment 检测），不在 suite-fix 的 release 侧——所以「out-of-scope → release → 全量 relaunch」循环【无界】，会无限跑（ac101 曾 ~2h）。

## Acceptance Criteria

- [ ] AC1: load-sensitive release 接 C11 隔离重跑（只重跑失败测试、低并发），非全量 relaunch。
- [ ] AC2: release 侧加 anti-livelock 兜底（attempt≥3 时 escalate/quiet-window，不再无限 relaunch）。
- [ ] AC3: 负控制落在生产载体——真实 fan-in 撞 load-sensitive 红，隔离重跑收敛（不再全量 relaunch 循环），或 attempt≥3 兜底打断（读生产 journal，非 fixture）。

## Definition of Done

- [ ] load-sensitive 红经隔离重跑收敛（或 anti-livelock 兜底打断），不再无界全量 relaunch（真实输出）。

## Touches

- tasks/gap-gate-release-no-isolate-rerun-no-livelock.md（自身）
- plugin/workflows/fan-in-execute.js（内联 suite-fix prompt：release 接隔离重跑 + anti-livelock 兜底；双拷贝同步 .claude/workflows/fan-in-execute.js）
- plugin/test/fan-in-execute-paths.test.mjs（隔离重跑 + 兜底负控制）
