---
id: gap-the-finding-shape-still-requires-a-plan-section
title: "The finding shape still lists plan as required, so a ## Finding task without ## Plan fails the gate — the last red assertion in the reinstall threshold"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

**这是重装门槛 e2e 里最后一条红断言。** 红断言数今晚从 **4 → 1**
（`install-config-driven-e2e`：A1/A2/A3 已绿）。

外层实测 A4 的精确失败点：

```
shape=finding  ok=false  artifacts={"proposal":true,"plan":false,"ac":true,"dod":true}
```

**`finding` 形状的必需段集合里仍然包含 `plan`**——而 **finding 形状的整个前提就是没有 `## Plan`**
（ADR-001：finding 型任务无 Plan 段，不该走里程碑严格契约）。

### 为什么它与现场数字不冲突（两者都真）

管理者实测 meta-cc **14 个 todo 有 11 个过闸**（先前 0/15）。**不矛盾**：

| | `## Finding` | `## Plan` | `plan` 判定 | 结果 |
|---|---|---|---|---|
| meta-cc 的 DIR 模板 | 有 | **也有** | `true` | **过闸** |
| e2e 的 A4 夹具 | 有 | **无**（断言名逐字如此） | **`false`** | **红** |

**⇒ 现场那批任务恰好都带 `## Plan`，所以掩盖了这个残留。**
**⇒ 只看现场会宣布 A4 完成；测试测的是判据本身，所以它红。**

## Contract

```
measure a4_red = `scripts/test.sh --test-name-pattern="A4" packages/quay/test/install-config-driven-e2e.test.mjs` 的 fail 计数字段
measure finding_requires_plan = `node --experimental-strip-types packages/quay-native/bin/quay-native.ts task check <finding-no-plan-id> --json` 输出中 artifacts.plan 的布尔字段
band a4_red = 0
invariant finding 形状不得要求 `## Plan`；每种形状的必需段来自形状注册表，不是共用一张表
invoke `node --experimental-strip-types packages/quay-native/bin/quay-native.ts task check <id> --json`
control `## Finding` 无 `## Plan` ⇒ 过 author→ready；`## Plan` 形状缺 `## Plan` ⇒ 仍必须红
resume 先看 SHAPE_REGISTRY 里 finding 的必需段集合，再改
```

## Chosen mechanism

**改的是形状注册表里 `finding` 的必需段集合，不是放宽通用判定。**

`finding` 的完整契约应当是它自己那套（Finding / AC / DoD 等），**在自己的量纲上同样严**——
**不是「少检查一项」**。这是 `gap-the-dod-gate-encodes-a-retired-task-shape` 已确立的原则
（注释逐字：*dispatch is not a waiver*），本条只是把它落到 `plan` 这一项上。

**不做**：不把 `plan` 从**所有**形状里去掉（`## Plan` 形状仍须要求它——AC3 是它的负控制）；
不给 `task check` 加旁路；**不改任何任务的内容去迁就闸**（人已裁定）。

## Acceptance Criteria

- [ ] AC1: **A4 变绿**——`a4_red = 0`（实跑输出贴任务体）
- [ ] AC2: **正向**——`## Finding` 无 `## Plan` 的任务 ⇒ `artifacts.plan` 不再参与 finding 形状的判定，
      `ok=true`（实跑贴出）
- [ ] AC3: **反向负控制**——`## Plan` 形状的任务**缺 `## Plan`** ⇒ **仍必须红**（实跑贴出）。
      **这条不过，AC2 不算数**——**把「finding 太严」修成「所有形状都不查 plan」是更坏的交易**
- [ ] AC4: **meta-cc 方向不退化**——带 `## Plan` 的 DIR 模板任务**仍然过闸**（实跑贴出）
- [ ] AC5: **门槛全绿**——`install-config-driven-e2e` **五条断言全绿**（`fail 0` 且 `cancelled 0`，实跑贴出）
- [ ] AC6: 测试用 `node:test` 且带 `// @test-group product`

## Definition of Done

- [ ] AC2 与 AC3 两个方向的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [ ] 任务体记录：**现场那批任务恰好都带 `## Plan`，所以掩盖了这个残留**——
      **只看现场会宣布完成，而测试测的是判据本身**

## Carries

from: gap-no-e2e-proves-install-is-configuration-driven
acs: AC5

本任务承载红 e2e 的 A4 绿（finding 无 Plan 过闸）：drop finding 形状的 Plan 要求后，
`packages/quay/test/install-config-driven-e2e.test.mjs` 的 A4 断言必须变绿——**谁修谁证明**。
（原 stub 承载任务 `gap-finding-shape-still-requires-plan` 已并入本条，避免重复承载。）

## Touches

- packages/quay-native/src/store.ts
- packages/quay-native/test/gate-shape-dispatch.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-04T02:12:00Z
changed: **重装门槛 e2e 的最后一条红断言**，外层实测定位：
`shape=finding ok=false artifacts={"proposal":true,"plan":false,...}`
⇒ **`finding` 形状的必需段集合里仍含 `plan`**。
**与管理者现场实测（meta-cc 11/14 过闸）不冲突且两者都真**：
**meta-cc 的 DIR 模板 `## Finding` 与 `## Plan` 两个标题都有**，所以 `plan: true`；
**e2e 的夹具是「`## Finding` WITHOUT `## Plan`」**，正是 ADR-001 说该放行的那一类。
**⇒ 现场那批任务恰好都带 `## Plan`，掩盖了残留；测试测判据本身，所以它红。**
**AC3 是真判据**：把「finding 太严」修成「所有形状都不查 plan」是更坏的交易——
本条只改 `finding` 的必需段集合，**不放宽通用判定**，
沿用 `dispatch is not a waiver` 那条已确立的原则。
**排序**：**它是门槛内唯一剩下的红断言** ⇒ 与 LOOP_SCRIPTS / tmux 同级最高，
且**不动 `quay-init.sh`**，可与它们并行。
