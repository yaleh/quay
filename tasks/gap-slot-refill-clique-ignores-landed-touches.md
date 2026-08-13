---
id: gap-slot-refill-clique-ignores-landed-touches
title: slot-refill 互斥团忽略 hasLandedImplementation 任务的 touches——landed-but-not-flipped 不再挤掉真工作
status: todo
labels:
  - gap
  - mechanism
parent: gap-slot-refill-landed-detection-implementation-file-classes
children: []
depends_on:
  - gap-slot-refill-landed-detection-implementation-file-classes
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（2026-08-13，outer 供给侧）**：`gap-phase-overlap-two-phase-parallel-exploration` 的
实现已合入 develop（ab689582）、round 157 全量绿验证，但其任务状态仍是 `ready`（未翻 done，
等 AC2 记录量收尾）。此期间 slot-refill 把它当**活跃的 ready 任务**计入互斥团计算：
其 Touches（`scripts/test.sh` + `plugin/scripts/full-suite-runner.ts`）与
`gap-single-flight-lock-2-slot-concurrent-suites`（P1）冲突 ⇒ **P1 被一个已落地任务从
推荐列表挤掉**，既不在 recommended、也不在 deferred，是团内排挤，机制无报错、无读数可查。

**同一类的第二 manifestation**：phantom-killer（`gap-slot-refill-recommends-landed-code-complete-tasks`，
c6fc14a7）管的是「recommended 列表别推荐已落地任务」——它用 `hasLandedImplementation` + `isLandedCodeComplete`
排除「已合待翻 done」形态。但当一个 landed 任务的未勾项不是 `（待外部）`（如 phase-overlap 的
DoD meta 箱），`isLandedCodeComplete` 不排除它 ⇒ 它留在 ready 池 ⇒ **它的 touches 继续占互斥团**，
挤掉真正可派的任务。**排除推荐的逻辑没覆盖到「排除它的 touches 对互斥团的影响」。**

**原则**：landed-but-not-flipped 任务的实现已在树里，不会（也不该）被重新派发——其 touches
对「谁可以和谁并行」的互斥判断**不应再算作活跃冲突**。这不是放行重叠派发（安全约束不变），
是**已落地内容不再占派发空间**。

**⚠️ 前置依赖（manager 2026-08-13 裁定：独立立案 + 声明依赖，不并进）**：本任务要在
`hasLandedImplementation` 谓词收窄之后才可落地——`gap-slot-refill-landed-detection-implementation-file-classes`。
**理由（安全性质）**：假阳性谓词 + 「忽略其 touches」= 一条实际没落地、真会冲突的任务，其 touches 被当作
不存在 ⇒ 与真冲突方被判 disjoint ⇒ 同时派发 ⇒ 两个 subagent 改同一批文件。**disjointness 是安全约束**——
让有假阳性的谓词去关闭它，比「landed 任务挤占池位」严重得多（后者只是慢，前者会真冲突）。
**⚠️ 本依赖当前【无机械强制】——软挡，不是硬挡**（manager 2026-08-13 裁定）：`depends_on` 目前
【零读者】（depsReadyFor 读 `parent` 不读 `depends_on`）；`parent` 的文档语义是「分解」（children 是
parent 的实现、不是前置），用它表达前置只是当前实现的副产物，代码注释明说「never a prerequisite a child
waits on」——将来若有人按注释语义校正 `depsReadyFor`，这条依赖会**静默消失**。**实际约束来自本任务保持
`status: todo`**（不进 ready 池即不可派）。**在 AC52 扩闸读 `depends_on` 之前，谁提升本任务谁负责先确认
谓词任务 `gap-slot-refill-landed-detection-implementation-file-classes` 已 done。**

## Plan

1. 在 slot-refill 的互斥团（dispatchable_disjoint / clique）计算里，对 `hasLandedImplementation(root, id)`
   返回 true 的 ready 任务，**不把它的 touches 计入团内冲突**（但仍保留其「推荐」排除，两处复用同一信号）。
2. 复用现有 `hasLandedImplementation`（slot-refill.ts 已有，纯 git 信号）——不另造取数。
3. 负控制：phase-overlap 未翻 done 时（模拟），2-slot 不应被挤掉；翻 done 后行为不变（回归）。
4. 既有 phantom-killer 测试保持绿（推荐排除逻辑不动，只动互斥团输入）。

## Acceptance Criteria

- [ ] AC1 互斥团计算忽略 `hasLandedImplementation=true` 的 ready 任务的 touches（复用现成信号，不新造）。
- [ ] AC2 负控制：一个 landed-but-not-flipped 任务（如 phase-overlap 翻 done 前形态）与一真新任务
      同碰文件时，新任务不再被挤掉；推荐排除仍生效（不重新推荐 landed 任务）。
- [ ] AC3 既有 phantom-killer 测试与 slot-refill 测试全绿（推荐排除逻辑未动）。
- [ ] AC4 该改动不改变「真重叠任务的串行化」——两个都未落地且同碰文件的任务仍互斥。

## Definition of Done

- [ ] slot-refill 测试绿（含新负控制用例）。
- [ ] 无回归：2-slot 派发、phase-overlap 类任务的关闭路径均正常。

## Touches

- plugin/scripts/slot-refill.ts（互斥团输入过滤 hasLandedImplementation 任务）
- plugin/test/slot-refill.test.mjs（负控制 + 回归用例）
- tasks/gap-slot-refill-clique-ignores-landed-touches.md（自身）

## Evidence

（落地后回填）
