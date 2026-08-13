---
id: gap-landing-target-branch-consistency-check
title: 任务落地目标分支无校验——按位置检查覆盖「落地目标 == 当前前锋分支」（机制家族第 4 次）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（2026-08-13，manager 捕获）**：新建任务 `gap-a1-freeze-unlanded-content-preserve` 时，
我把落地目标写成「合入 integration」，而当前分支模型是 **develop 为前锋分支**
（`develop..integration = 0` 不变式、AC48 integration 退役在册、AC50 判据1 每轮采样此量）。
往 integration 合会把 `develop..integration` 从 0 变非 0、重开两线、把**已勾的 AC50 判据1 变假**，
而没有任何检查会报出来（勾选表是手工维护的）。

**同一机制的家族第 4 次**（C4 的「写落 integration」/ `--verify-cron` 死 flag / 已退休的 ≤80 行判据
之后，这次出现在一条【刚写的】任务里）⇒ 不是历史遗留，是**每次分支模型变动都会新产生**的指令漂移。
修的是「落地路径」这个字段与当前分支模型的一致性，不是某一条任务。

**同类既有判据**：`gap-concurrency-literal-only-at-definition-points`（按位置判定，只允许并发字面量落在
定义点）——本任务把同一思路覆盖到分支名：任务体里的落地目标分支（「合入 X」/「merge 到 X」）必须
== 当前前锋分支。

## Plan

1. 定义「前锋分支」的机械判据：`develop..integration = 0`（integration ⊆ develop）⇒ 前锋分支 = develop；
   分支模型再变时此关系自然迁移，不硬编码分支名。
2. 新建检查器 `plugin/scripts/landing-target-check.ts`（仿 `concurrency-literal-check.ts` 形态，
   含 `checker-mutation-cases/landing-target-check.sh` fixture）：扫描 `tasks/*.md` 的落地目标表述
   （合入 X / merge 到 X / 落到 X），与前锋分支比对；不一致即 fail，按位置报告（文件+行+目标分支）。
3. 接入静态检查泳道（`scripts/test.sh` 的 run_static_checks，同 concurrency-literal 的接入点）。
4. 历史修正：启用时对当前任务池全扫一遍，列出所有已写 integration 落地目标的表述，逐一改为 develop
   或按「本次例外何时清回 0」说明（不静默留下漂移指令）。

## Acceptance Criteria

- [ ] AC1 检查器存在：任务落地目标分支 ≠ 前锋分支时 fail，按位置报告（文件+行+目标分支）。
- [ ] AC2 前锋分支判定不硬编码：由 `develop..integration` 关系推出，分支模型变动时读宿主、不写死。
- [ ] AC3 检查接入静态检查泳道，有产物（mutation case fixture 保真）。
- [ ] AC4 启用时全池扫描一遍，修正所有不一致的落地目标表述，无残留。

## Definition of Done

- [ ] 检查器静态泳道绿跑（scoped 0 fail），对已知反例（历史 integration 落地目标）报出并被修正。
- [ ] 无假阴性：`develop..integration=0` 成立时只接受 develop；假阳性 fixture 全部通过。
- [ ] `gap-a1-freeze-unlanded-content-preserve` 这类任务不会再因落地目标错误被退回（检查在位）。

## Touches

- plugin/scripts/landing-target-check.ts（新检查器）
- plugin/scripts/checker-mutation-cases/landing-target-check.sh（新检查器 mutation case）
- scripts/test.sh（run_static_checks 接入，同 concurrency-literal 接入点）
- tasks/gap-landing-target-branch-consistency-check.md（自身）

## Evidence

（落地后回填）
