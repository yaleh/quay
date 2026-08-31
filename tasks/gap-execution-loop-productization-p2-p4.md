---
id: gap-execution-loop-productization-p2-p4
title: 执行环产品化 P2–P4——runMechanicalFanIn→quay task fan-in + workflow 兜底降级 +
  suite/dispatch 产品化
status: needs-human
labels:
  - gap
  - productization
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-adr034-fan-in-lock-holder-supervised
---
**type:** execution

## Proposal

落实 `orchestration/SPEC-execution-loop-productization-2026-08-28.md` 的 **P2**（P1=ADR-034 已 done；P3/P4 已拆出见 children，人 2026-08-30 决策 B 拆条）。P2：`runMechanicalFanIn` 产品化为 `quay task fan-in` CLI verb + MCP 工具，吸收 fan-in-ff-merge.sh 的锁/clean-tree/escalation/ff 业务为 TS 模块，删 fan-in-ff-merge.sh。

**背景（SPEC §2）**：fan-in 同一业务 3 套实现（机械 worker-driver / workflow 兜底 fan-in-execute.js / bash fan-in-ff-merge.sh）。目标：一个业务过程一套实现，落 packages/quay。

## Plan

`runMechanicalFanIn` 产品化为 `quay task fan-in` verb + MCP 工具；fan-in-ff-merge.sh 业务吸收为 TS 模块（`packages/quay/src/fan-in/ff-merge.ts`）；删 fan-in-ff-merge.sh；L1 token 闸在该 TS 模块内实现（⛔ 非旧 .sh）。

## Acceptance Criteria

- [ ] AC1（P2 能取假）：一次真实 fan-in 经 `quay task fan-in` verb 落地；fan-in-ff-merge.sh 改为 .ts 模块被 import，bash 版删除后零引用、无 shell-out；L1 token 闸在该 TS 模块内实现（⛔ 仍经旧 .sh / shell-out ⇒ 假；⛔ token 闸语义丢失 ⇒ 假）。

## Definition of Done

P2 落地；AC1 全勾；fan-in-ff-merge.sh 删除零引用；L1 token 闸在 TS 模块内。

## Touches

- packages/quay/src/cli/task-fan-in.ts (new)
- packages/quay/src/cli/help.ts
- packages/quay/src/mcp-server.ts
- packages/quay/src/mcp-handlers.ts
- packages/quay/bin/quay.ts
- packages/quay/src/fan-in/ff-merge.ts (new)
- plugin/scripts/worker-driver.ts
- plugin/scripts/fan-in-ff-merge.sh（P2 删除）
- tasks/gap-execution-loop-productization-p2-p4.md（自身）
## Needs-Human

**执行 2026-08-31T00:04:01.660Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=ff: bash: /home/yale/work/quay-worktrees/gap-execution-loop-productization-p2-p4/plugin/scripts/fan-in-ff-merge.sh: No such file or directory
