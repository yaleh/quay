---
id: gap-ac116-spec-phase2-concurrency-stash
title: AC116 SPEC §5 阶段 2——驱动控并发 + 超时杀 worker 保留 worktree + checkout 前 stash
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac115-spec-phase1-drive-single-worker
---

**type:** execution

## Proposal

**来源**：manager 投「结晶」阶段 AC116（编号绑定：SPEC §5 阶段 2，判据正本在 SPEC，⛔ 不在此复制）。

**形态**：驱动控并发数、超时杀 worker（保留 worktree）、checkout 前 stash。

**为什么 inner 执行**：驱动并发控制 + 退役裁决面属产品机件 → inner 域。

## Plan

1. 驱动加并发控制（N 并发）+ 超时 SIGTERM（保留 worktree）+ checkout 前 stash。
2. 取假验证：留未提交改动 ⇒ 驱动 stash（stash list 可核）；构造卡死 worker ⇒ 墙钟超时 SIGTERM、worktree 仍在。

## Acceptance Criteria

- [ ] AC1：N 并发跑、主检出 `git status --porcelain` 恒空（除 ff 持锁瞬时）。
- [ ] AC2（能取假）：留一个未提交改动 ⇒ 驱动 stash（stash list 可核），⛔ 不得 discard。
- [ ] AC3：超时——构造卡死 worker ⇒ 墙钟超时 SIGTERM、worktree 仍在。

## Definition of Done

- [ ] 并发控制 + stash + 超时保 worktree 落地，取假两向通过；AC1-3 全勾；land 到 develop。

## Retires

- cap-from-gate / process-budget 的并发裁决用途
- A6「检查 fan-in 是否走 workflow」

## Touches

- plugin/scripts/worker-driver.ts（并发控制 N + 超时 SIGTERM + checkout 前 stash）
- plugin/scripts/cap-from-gate.sh（退役裁决面）
- plugin/scripts/cap-from-gate.ts（退役裁决面——裁决逻辑模块，非薄包装）
- plugin/scripts/process-budget.sh（退役裁决面）
- plugin/scripts/fan-in-workflow-check.ts（A6「检查 fan-in 是否走 workflow」退役面）
- plugin/test/worker-driver.test.mjs（阶段 2 测试：AC1 并发 / AC2 stash / AC3 超时）
- tasks/gap-ac116-spec-phase2-concurrency-stash.md（自身）

> **Touches 扩充说明**（相对立案时新增 3 项）：① `cap-from-gate.ts`——`cap-from-gate.sh` 只是
> thin bash 包装（`exec node … cap-from-gate.ts`），「并发裁决面」的实际逻辑在 `.ts` 模块，退役横幅
> 两处都落；② `fan-in-workflow-check.ts`——`## Retires` 明确列「A6 检查 fan-in 是否走 workflow」，
> 该检查正身即此文件，退役横幅落此处；③ `worker-driver.test.mjs`——AC1/AC2/AC3 的取假证据必须落在
> scoped 单测里（硬约束「跑 scoped 单测」），是实现的必带产物。
