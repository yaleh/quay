---
id: gap-architecture-review-not-triggered-lacks-per-detector-state
title: architecture-review 的 not-triggered 缺 per-detector 状态——「无候选宇宙」与「三检测器都评估且干净」同形
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/scripts/quality-gate-driver.ts:941` 把 not-triggered 原因写死为「no candidate clusters (three detectors produced zero suspicious groupings)」。在非 quay 树上检测器可能没有候选宇宙（space instrument 同款问题），此时 `not-triggered` 与「三个检测器都评估过且都干净」同形。实测 ClaudeCodeUI 的 architecture-review 83/83 轮全零即被读成「干净」——实则检测器无候选宇宙。

## Plan

1. `computeArchReviewTrigger` 返回 `detectors: [{ id, evaluated: boolean, reason, clusters }]`（每个检测器自报是否评估过、有无候选宇宙）。
2. 新增 `not-evaluated` 状态；`not-triggered` 仅在三个检测器全部 `evaluated:true` 且 `clusters=[]` 时成立。
3. 把 per-detector 状态写进 `architecture-review-round.jsonl` 每条记录。

## Acceptance Criteria

- [ ] AC1（能取假·状态可分）任一 detector `evaluated:false` 时 round state 为 `not-evaluated` 且记录带该 detector 的 reason；仍写 `not-triggered` 即假。
- [ ] AC2（干净的真条件）`not-triggered` 仅在 `detectors.every(d => d.evaluated && d.clusters.length===0)` 时成立——一条命令可从 round jsonl 验证该蕴含。
- [ ] AC3（载体可读）`architecture-review-round.jsonl` 每条含 `detectors` 数组，其成员带 id/evaluated/reason/clusters。

## Definition of Done

round 状态三态化（judged / not-triggered / not-evaluated），per-detector evaluated+reason 入载体；AC1–AC3 勾。

## Touches

- plugin/scripts/architecture-review-cluster.ts（computeArchReviewTrigger + round 记录类型）
- plugin/scripts/quality-gate-driver.ts（:941 处 not-triggered 判定改用 detectors）
- tasks/gap-architecture-review-not-triggered-lacks-per-detector-state.md