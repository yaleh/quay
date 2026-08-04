---
id: ADR-023
title: "The DoD gate dispatches by task shape (SHAPE_REGISTRY): contract/finding/plan each have a complete contract, unknown shapes fail closed"
status: accepted
date: 2026-08-04
tags:
  - gate
  - architecture
  - provider-abi
applies-to:
  - packages/quay-native/src/store.ts
  - packages/quay-native/test/gate-shape-dispatch.test.mjs
  - tasks/gap-the-dod-gate-encodes-a-retired-task-shape.md
---

## 裁定

**`task check` 的 author→ready 闸按任务形状分派，而不是一刀切要求经典的
Proposal/Plan/AC/DoD 四段。形状 → 必需段的映射集中在 `SHAPE_REGISTRY`
（单一真源，可被测试直接 import）；每种已注册形状有自己完整、等严的契约；
未知形状 fail-closed。**

本决定是对 07-29 ADR-001（从未提交、实现又被并发里程碑当无关变更丢弃、
两条线索同时缺失导致五天无人发现）的**落地重述**——按外层实测把形状集合与
各自必需段定死，并把决定提交进版本库。

## 背景

- 旧闸 `artifactSections()` 无条件 `every()` 要求 `proposal/plan/ac/dod` 四段齐全，
  其中 `ac`/`dod` 允许别名，但 `proposal` 只认 `## Proposal`、`plan` 只认 `## Plan`。
- **ADR-022（2026-08-03）用 `## Contract` 取代 `## Plan`** ⇒ quay 自己今天写的
  快速模式任务（40 个 Contract 格式）被闸判 `FAIL — missing artifacts: plan`。
- **meta-cc 的 DIR 模板用 `## Finding` 取代 `## Proposal`** ⇒ 14 个 todo Finding
  模板任务被闸判 `proposal:false`，ready 队列为 0，循环只能绕过闸达到 ready。
- 快速模式不调 `task check`，所以闸在 quay 里是死代码——只有真去跑它的人
  （meta-cc 冷启动）才会撞上，五天无人发现。

## 决定

1. **分派而不是豁免**：按形状选择契约，而不是给某些形状少检查几项。
2. **每种形状的契约完整且在自己量纲上同样严**：
   - `contract`（quay 快速模式）：proposal=`## Proposal`，plan=`## Contract`
     **且六键齐全**（measure/band/invariant/invoke/control/resume）——比散文
     Plan 更可机械检查，不是更宽松。
   - `finding`（meta-cc DIR 模板）：proposal=`## Finding`，plan=`## Plan`，
     ac/dod 沿用别名。
   - `plan`（经典模板）：不变（proposal=`## Proposal`，plan=`## Plan`）。
3. **未知形状 fail-closed（AC5）**：`type:` 不在注册表里（body 无 Contract/
   Finding/Plan 段）⇒ 直接红，绝不落入最宽松的分支。
4. **形状注册表是单一真源**：`SHAPE_REGISTRY` 集中一处、可被测试直接
   `import`，不散落在 `has("Plan")` 字面判断里。

## 明确不做

- 不放宽任何现有形状的严格度（Contract 形状反而更严）。
- 不给 `task check` 加 `--force`/`--skip` 之类的官方旁路（本条的立案理由正是
  「靠绕过达到 ready」，再加一个官方旁路是自相矛盾）。
- 不批量重写 387 个 Plan 格式的历史任务（它们对经典形状仍然合规）。
- 不改 meta-cc 任务内容去迁就闸（人已裁定修复在本仓这边）。

## 落地与验证

- `packages/quay-native/src/store.ts`：`SHAPE_REGISTRY` + `detectShape()` +
  `contractKeysPresent()` 导出；`check()` 的 todo 分支按形状分派，未知形状
  fail-closed，Contract 六键校验。
- `packages/quay-native/test/gate-shape-dispatch.test.mjs`（node:test、
  `@test-group product`）：8 用例覆盖 AC1–AC8。
- 实跑对照见任务体：`DEMO-CONTRACT`/`DEMO-PLAN`/`DEMO-FINDING` 过闸；
  `DEMO-MISSKEY` 红并点名 `resume`；`DEMO-UNKNOWN` 红并报 unrecognized shape；
  meta-cc `DIR-082` 的 `proposal` 由 `false` 变 `true`，14 个 todo Finding 任务
  中 11 个过形状+四段检查。
