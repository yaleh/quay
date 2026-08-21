---
id: gap-ac125-suite-bucket-no-miss-negative-control
title: AC125 漏测负控制（3 次真实跨层回归回放 3/3 仍选中会红的测试——唯一的"没漏"判据）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac120-suite-bucket-attribution-mechanism
  - gap-ac122-suite-bucket-hub-list-full-suite
  - gap-ac123-suite-bucket-cross-bucket-both-sides
---

**type:** execution

## Proposal

**来源**：`orchestration/manager-phase-goal.md` 当前阶段 AC125（⛔ 唯一证明「没漏」的判据——其余五条都在证明「能省」）。

**判据（能取假）**：取本仓历史上**至少 3 次真实的跨层回归**（一个桶的源码改动打红了另一个桶的测试；从 `verification-round.jsonl` 红轮 + 对应提交回溯），回放分桶规则，**必须 3/3 仍然选中那个会红的测试**。

**⊢ 为什么必须有这条**：AC120-124 都在证明「能省」，只有这条在证明「没漏」。⛔ 缺这条则本阶段的达成等于一个恒绿判据。

**为什么 inner 执行**：回溯历史红轮 + 回放分桶规则 → inner 域。

## Plan

1. 从 `verification-round.jsonl` 红轮 + 对应提交回溯至少 3 次真实跨层回归（一桶源码改动打红另一桶测试）。
2. 对每次回归回放分桶规则，确认那个会红的测试仍在选中集。
3. 记录 3/3 回放结果，可复核。
4. fan-in land。

## Acceptance Criteria

- [ ] AC1: 回溯 ≥3 次真实跨层回归（verification-round.jsonl 红轮 + 对应提交）。
- [ ] AC2: 分桶规则回放，3/3 仍然选中那个会红的测试。

## Definition of Done

- [ ] ≥3 次真实跨层回归回放 3/3 仍选中会红测试；land 到 develop；AC1-2 全勾。

## Touches

- tasks/gap-ac125-suite-bucket-no-miss-negative-control.md（自身）
