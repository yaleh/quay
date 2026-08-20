---
id: gap-wiring-D-worktree-remove-orphans-reclaim-restore
title: 接线任务 D（根因⑤）：worktree-remove-orphans-probes 的 fan-in-ff stale-lock reclaim
  被漂移撤销——恢复 reaper 接线
status: ready
labels:
  - gap
  - mechanism
  - wiring
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-20 接线审计（8 NOT-WIRED 之一根因⑤，性质特殊——被漂移撤销）。

**根因**：`gap-worktree-remove-orphans-probes` 的第三子项（`fan-in-ff-merge.sh` 持锁段 stale-lock reclaim）真接线了约 7 小时（`989ec472`），随后被**不相关**的提交 `9645a4ff`（"suite 并发量 SSOT"）静默替换成不调用 reaper 的窄检查。属硬规则 5b 领域：修好的东西被别处漂移撤销，无 anti-drift 守着这个 seam。

**⛔ Touches 边界**：`plugin/scripts/fan-in-ff-merge.sh`。与 A、B、C 零交集。

## Plan

1. 核实 `989ec472` 的真接线（持锁段 stale-lock reclaim 调 reaper）与 `9645a4ff` 的替换（窄检查不调 reaper）。
2. 恢复 reaper 接线（或按当前架构调整——但不得静默替换成不调用 reaper）。
3. 生产载体验证：真实 stale-lock 场景下 reaper 被调用（非 fixture）。

## Acceptance Criteria

- [ ] AC1: fan-in-ff-merge.sh 持锁段恢复调 reaper（stale-lock reclaim），不再被 9645a4ff 的窄检查替换。
- [ ] AC2: 生产载体验证——真实 stale-lock 场景 reaper 被调用（非 fixture）。
- [ ] AC3: 全量 suite 绿。

## Definition of Done

- [ ] fan-in-ff-merge.sh 持锁段恢复调 reaper（stale-lock reclaim，不再被 9645a4ff 窄检查替换）；生产载体验证（真实 stale-lock 场景 reaper 被调用）；全量 suite 绿（scripts/test.sh exit 0）；修复提交可 git log 追溯。

## Touches

- plugin/scripts/fan-in-ff-merge.sh（恢复 reaper 接线）
- tasks/gap-wiring-D-worktree-remove-orphans-reclaim-restore.md（自身）
