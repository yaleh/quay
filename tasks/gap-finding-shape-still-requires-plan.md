---
id: gap-finding-shape-still-requires-plan
title: "The finding shape still requires ## Plan, so a Finding-without-Plan task fails the gate — the e2e's A4 stays red"
status: todo
labels:
  - gap
extra:
  schema: v1
---

**type:** execution

## Proposal

`gap-the-dod-gate-encodes-a-retired-task-shape` 已合（SHAPE_REGISTRY 形状分派），它让
`Finding + Plan` 过闸。但 `SHAPE_REGISTRY.finding.sections.plan` 仍是 `["Plan"]`——**Finding 无
`## Plan` 的任务仍被拒**（`artifacts={"proposal":true,"plan":false,...}` reason="missing artifacts: plan"）。

红 e2e 的 A4 断言（`## Finding` 无 `## Plan` 必须过闸）因此保持红。**本任务是 dod-gate 的后续**：
finding 形状的 plan 槽应允许缺失（finding 模板本来就没有 Plan，Plan 是经典里程碑模板的段）。

## Contract

```
measure finding_no_plan = `node --experimental-strip-types packages/quay-native/bin/quay-native.ts gate <一个 Finding 无 Plan 的任务>` 的 ok 字段
band   finding_no_plan = true
invariant finding 形状的 plan 槽可缺失；含 ## Plan 的仍走严格契约（A4 两个方向）
invoke `bash scripts/test.sh packages/quay/test/install-config-driven-e2e.test.mjs`（A4 断言）
control 一个 Finding 无 Plan 的任务 ⇒ 必须过闸；一个 Finding 带 Plan 或经典 Plan 任务 ⇒ 契约不变
resume 先改 SHAPE_REGISTRY.finding.sections.plan，再让 e2e A4 变绿
```

## Carries

from: gap-no-e2e-proves-install-is-configuration-driven
acs: AC5

本任务承载红 e2e 的 A4 绿：drop finding 形状的 Plan 要求后，
`packages/quay/test/install-config-driven-e2e.test.mjs` 的 A4 断言必须变绿——**谁修谁证明**。

## Acceptance Criteria

- [ ] AC1: `SHAPE_REGISTRY.finding.sections.plan` 允许缺失（finding 无 Plan 过闸）
- [ ] AC2: e2e 的 A4 断言变绿（实跑贴出）
- [ ] AC3: 负控制——含 `## Plan` 的 Finding 或经典 Plan 任务契约不变（两个方向都贴）
- [ ] AC4: 测试用 `node:test` 且带 `// @test-group`

## Touches

- packages/quay-native/src/store.ts
- packages/quay-native/test/gate-shape-dispatch.test.mjs
- packages/quay/test/install-config-driven-e2e.test.mjs

## Dispatch review

reviewer: inner
at: 2026-08-04T01:5xZ
changed: 协调方（内层）自建——承载红 e2e 的 AC5（finding 无 Plan 过闸，dod-gate 的后续）。
无外层 review（内层建任务先例，红 e2e 的 AC 承载需要）。
