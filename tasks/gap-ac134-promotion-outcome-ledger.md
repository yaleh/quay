---
id: gap-ac134-promotion-outcome-ledger
title: AC134 判定/晋升/修复各落一条 outcome（outer 可消费）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac130-promotion-driver-resident-loop
---

**type:** execution

## Proposal

**来源**：manager 投立案（判据正本在 `orchestration/manager-phase-goal.md` `### AC134`，⛔ 不在此复制，读那一段）。

**形态**：驱动的每次【判定】【晋升】【修复】各写一条结构化记录到运行时载体（gitignored，同 `worker-outcome.jsonl` 族）。

**依据**：SPEC §7 人裁定「跨任务模式识别归 outer」，而 outer 只能读记录——没有这条，晋升面机械化之后 outer 就瞎了（同 AC115 的 outcome 记录之于 inner 侧）。

## Plan

1. promotion-driver.ts 加 outcome 落盘：判定/晋升/修复各写一条，字段含任务 id、闸判定（含 missing）、动作（promote/fix/skip）、结果、时刻。
2. 载体 `.quay/promotion-outcome.jsonl`（gitignored）。
3. 取假验证（读生产载体）：载体中实现 land 之后的真实记录条数 ≥ N。

## Acceptance Criteria

- [x] AC1：每次【判定】【晋升】【修复】各写一条结构化记录到运行时载体（gitignored），字段至少含：任务 id · 闸判定结果（含 missing 清单）· 动作（promote/fix/skip）· 结果 · 时刻。
- [ ] AC2（能取假，读生产载体）：判据是载体中【实现 land 之后】的真实记录条数 ≥ N，⛔ fixture/注入数据不算；若把注入 seam 关掉后该 AC 仍能通过，它才是测量。（待外部）

## Definition of Done

- [ ] outcome 台账落地 + 生产载体真实记录条数达标；AC1-2 全勾；land 到 develop。（待外部）

## Retires

- 无（新增机制）

## Touches

- plugin/scripts/promotion-driver.ts（outcome 落盘）
- plugin/test/promotion-driver.test.mjs（AC134 单测）
- .quay/promotion-outcome.jsonl (new)
- .gitignore（新增 promotion-outcome.jsonl 忽略）
- tasks/gap-ac134-promotion-outcome-ledger.md（自身）
