---
id: gap-judgepoolcandidate-keyword-vs-position
title: judgePoolCandidate 按关键词不按位置 — DIR-103 出处注假阳性标 retired-mechanism（硬规则 2 违规）
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**按关键词命中不按位置（manager 2026-08-12 00:39 003953，硬规则 2 违规）**：`judgePoolCandidate`（`strategic-doc-staleness-check.ts`）按关键词命中，不按位置——它在 `DIR-103` 的**出处注**上命中了 `prepare-milestone.js`，从而把一个主题为活产品代码的任务（`acceptance-runner.ts`）永久标成 retired-mechanism、`eligible` 恒为 false。

**出处注是什么**：DIR-103 的 `line=25, hit=prepare-milestone.js` 那一行是「**Split 2026-08-01 (DIR-026 SPLIT-OR-COMMIT):** a real prepare-milestone.js ProposalReview run against this task's Proposal returned …」——这是「谁评审过它」的出处注，**不是它要做的事**。

**违反硬规则 2 字面**：「按位置判定，不按关键词——注释、字符串、消息正文里提到不算命中」。任务体里的出处注/历史记录正是「消息正文里提到」的典型。

**连带后果（manager 预警）**：001445 报的「6 条 retired-mechanism 永久噪声」取自机件 `intercepted` 数组，**那 6 条里可能同样含出处注假阳性**。处置 #44（池质量清理）前**先逐条看命中行的位置**，别按数组整批关——否则误杀与 DIR-103 同类的活任务。

**修法方向（outer 裁定）**：命中判定排除代码块/引用块/带 "Split/ProposalReview/历史/CLOSEOUT" 等出处标记的行；或更强——只在 `## Touches` 与 `## Plan/Contract` 段内命中才算 targeting a retired mechanism。

**验证锚**：修后 (a) DIR-103 eligible=True（不再被出处注假阳性误标）；(b) 真 retired-mechanism 任务仍被拦；(c) `--for-task` scoped 门绿；(d) 不回归。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 DIR-103 出处注假阳性（line 25 "Split 2026-08-01 … prepare-milestone.js ProposalReview"，主题对象是活代码 acceptance-runner.ts）（本任务 Proposal 已含）
- [ ] AC2: **按位置判定**——judgePoolCandidate 排除出处标记行（Split/ProposalReview/历史/CLOSEOUT）或限定 Touches/Plan/Contract 段内命中
- [ ] AC3: **DIR-103 解锁**——修复后 DIR-103 eligible=True（不再被误标 retired-mechanism）
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿；真 retired-mechanism 仍被拦
- [ ] AC5: **自身解锁自证**——修复后本任务自身 eligible=True（不再被 retired-mechanism 假阳性吃掉；直接派发任务，绕过池闸——池闸正是 bug 本身，outer 裁定选项 1）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：DIR-103 eligible 读数 + 真 retired-mechanism 仍拦 + 本任务自身 eligible 贴出
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/strategic-doc-staleness-check.ts（judgePoolCandidate 按位置判定）
- plugin/test/strategic-doc-staleness-check.test.mjs（出处注假阳性用例）
- tasks/DIR-103.md（交叉标注——修复后不被误标 retired-mechanism）
- tasks/gap-judgepoolcandidate-keyword-vs-position.md（自身：勾 AC + 贴证据）

## Contract

measure   dir103_eligible = `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root . --cap 5 --json` 对 DIR-103 的 eligible 读数
band      dir103_eligible = true（修复后不再被出处注假阳性误标）
invariant genuine_retired_still_blocked = 1（真 retired-mechanism 任务仍被拦）
invariant position_not_keyword = 1（judgePoolCandidate 按位置判定，出处注不算命中）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root . --cap 5 --json`（贴 DIR-103 eligible 读数）
control   按位置判定生效；DIR-103 解锁；真 retired-mechanism 仍拦；既有不回归
resume    judgePoolCandidate / 测试 / 交叉标注分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-12
changed: manager 003953 定位（judgePoolCandidate 关键词非位置，DIR-103 出处注假阳性）。硬规则 2 违规。outer 裁定修法方向。实现归 inner。
