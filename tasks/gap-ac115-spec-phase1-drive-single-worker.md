---
id: gap-ac115-spec-phase1-drive-single-worker
title: AC115 SPEC §5 阶段 1——驱动 spawn 单 claude -p worker 跑完整任务（选择→worktree→开发→suite→ff）
status: todo
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

**来源**：manager 投「结晶」阶段 AC115（编号绑定：`orchestration/SPEC-worker-driven-inner-2026-08-16.md` §5 阶段 1，判据正本在 SPEC，⛔ 不在此复制）。

**形态**：驱动 spawn 一个 `claude -p` worker 跑完整任务（选择→worktree→开发→suite→ff）。

**为什么 inner 执行**：驱动脚本 + outcome 记录属产品机件 → inner 域。

## Plan

1. 实现驱动脚本：spawn 一个 `claude -p` worker 跑完整任务链路（选择→worktree→开发→suite→ff）。
2. 结构化 outcome 落盘字段齐全（SPEC §4③ 形态）。
3. 取假验证：杀 worker ⇒ 驱动察觉并记录，不静默丢任务。

## Acceptance Criteria

- [ ] AC1：在飞 = 驱动子进程数（直接量，⛔ 非代理量；不一致以驱动为准）。
- [ ] AC2：worker 退出码 + 结构化 outcome 落盘字段齐全（SPEC §4③）。
- [ ] AC3（能取假）：杀 worker ⇒ 驱动察觉并记录，⛔ 不静默丢任务。

## Definition of Done

- [ ] 单 worker 驱动落地 + outcome 字段齐全 + 杀 worker 取假通过；AC1-3 全勾；land 到 develop。

## Retires

- `--in-flight` 参数传递（slot-refill）
- 遥测括号的「在飞」用途

## Touches

- plugin/scripts/worker-driver.ts (new)（驱动脚本，落点 inner 定）
- .quay/worker-outcome.jsonl (new)（outcome 记录）
- plugin/scripts/slot-refill.ts（--in-flight 退役面）
- tasks/gap-ac115-spec-phase1-drive-single-worker.md（自身）
