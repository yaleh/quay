---
id: gap-ac124-suite-bucket-production-carrier-benefit
title: AC124 分桶收益落生产载体（≥10 轮带桶字段 + P/M 各 ≥3 轮中位数 ≤40% 全量）
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

**来源**：`orchestration/manager-phase-goal.md` 当前阶段 AC124。

**判据**：分桶执行启用后，`.quay/verification-round.jsonl` 中**新于本阶段切换**的轮次里，至少 10 轮带上「本轮跑了哪几桶 + 该桶文件数 + 该桶耗时」的字段；且**仅 P 变更**与**仅 M 变更**两类各至少 3 轮，其 `durationMs` 中位数分别 ≤ 全量中位数的 40%。

**⛔ 不接受估算值**（同 `gap-phase-boundary-differential-accounting` 推论三：fixture/估算正确 ≠ 已产出）。**阈值来源**：基线实测 P=21.9%、M=18.1%，40% 是含跨桶与兜底后的宽松上界，不是凭空设的数。

**⛔ 前提**：AC121（133 个逐条重归属）已 land——否则启用分桶执行等于给出会漏测的绿。

**为什么 inner 执行**：启用分桶执行 + 跑轮次 + 读生产载体 → inner 域。

## Plan

1. 分桶执行启用（前置 AC120/AC121/AC122/AC123 已 land）。
2. 确保 `.quay/verification-round.jsonl` 新轮次带桶字段（桶 + 文件数 + 耗时）。
3. 累计 ≥10 轮带桶字段；P-only 与 M-only 各 ≥3 轮，`durationMs` 中位数 ≤ 全量中位数 40%。
4. fan-in land。

## Acceptance Criteria

- [ ] AC1: `.quay/verification-round.jsonl` 中新于阶段切换的轮次 ≥10 轮带「本轮跑哪几桶 + 桶文件数 + 桶耗时」字段。
- [ ] AC2: 仅 P 变更 ≥3 轮、仅 M 变更 ≥3 轮，各自 `durationMs` 中位数 ≤ 全量中位数 40%。

## Definition of Done

- [ ] 分桶执行启用后生产载体 ≥10 轮带桶字段，P/M 各 ≥3 轮中位数 ≤40%；land 到 develop；AC1-2 全勾。

## Touches

- tasks/gap-ac124-suite-bucket-production-carrier-benefit.md（自身）
