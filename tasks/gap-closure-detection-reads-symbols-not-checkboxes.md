---
id: gap-closure-detection-reads-symbols-not-checkboxes
title: "收尾信号耦合在「任务写法」不耦合在「完成状态」——ready-pool 61% 是 AC 全勾未翻转（实测 17/21）；
  taskWorkLanded（task-status-drift-check.ts:519）只读 symbolResolved||touchLanded||gitHistory，
  三条都不读 AC 勾选框；AC 写散文的任务无论完成与否都不可见（gap-cold-start 4/4、concurrency-derivation
  14/14 等）；修法 = not-yet-flipped 加并列信号 all_acs_checked && status==ready（与 taskWorkLanded 并集，
  不替换）"
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**ready-pool 61% 是「AC 全勾未翻转」——inner 每轮核一遍、退回、空转，因为收尾信号看错了对象。**

### 实测（manager 2026-08-08 11:4x 三层诊断 L1/L3 + 外层复核）

**L1（供给）**：ready 且有 AC 的任务中，**AC 全勾者 = 17/21**。inner 点名的都在里面：
gap-cold-start-outer-validation-runs (4/4)、gap-full-suite-runner-marks-test-sh-gate-wait-as-failed
(4/4)、gap-concurrency-derivation-reverted-... (14/14)、gap-tests-leak (10/10) 等。
⇒ inner 不是不派，是推给它的大概率全是已完成的。

**L3（收尾信号）**：`ready-pool-check.ts` 的 `notYetFlipped`（:224）由 `taskWorkLanded`
（`task-status-drift-check.ts:519`）决定：
```
return symbolResolved || touchLanded || gitHistory;
  symbolResolved = 从【AC 文本】抽出的符号候选 ≥60% 在仓库解析到
  touchLanded    = ## Touches 里的 (new) 条目现在存在
  gitHistory     = git 历史提到它
```
**三条没有一条读 AC 的勾选框。** ⇒ 收尾信号耦合在「任务的写法」上，不耦合在「任务的完成状态」上。
AC 文本符号密集的（带文件名/函数名）会被抓到；AC 写散文的，**无论完成没完成都不可见**。

### 修法方向（manager 建议，外层裁定：并集不替换）

给 `not-yet-flipped` 加一个**并列**的信号：
```
all_acs_checked && status == ready ⇒ 收尾候选
```
它**不替换** `taskWorkLanded`（那条抓的是「勾没勾完但工作已落地」的另一半，gap-ready-pool-check-counts-
merged-not-flipped-tasks-in-the-pool 的语义），是**并集**。`countAcCheckboxes`（task-status-drift-check.ts:128）
已存在，直接复用。

### 三层耦合关系（别只修一层）

- 修 L3 而 L2（cap=3）不修 ⇒ 空转变快，不变少（L2 实测 tick 文档已传 effective_cap，生产路径对，
  兜底 3 仅 fail-closed——比 manager 说的轻，但值得确认）
- 修 L1 而 L3 不修 ⇒ 收尾仍靠人工核，池继续堵
- 修 L1+L3 而 inner 无自驱 ⇒ 仍要等 outer 戳

## Contract

```
measure all_acs_ready = 遍历 tasks/*.md，`status: ready` 且 AC 全勾（countAcCheckboxes checked==total>0）的任务数 stdout 数字段
band all_acs_ready = 0（修复后这些任务被 not-yet-flipped 抓到并从 dispatchable 移出；当前=17）
invoke `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --cap 5 --json`
control 负控制：taskWorkLanded 仍抓「落地未勾」任务（并集不替换）；勾了但工作没落地的任务不被误翻转
resume 若中断，先跑 measure 读 AC 全勾 ready 任务数，不要假设已修
```

## Acceptance Criteria

- [ ] AC1: **并列信号**——`notYetFlipped` 加 `all_acs_checked && status==ready`（与 taskWorkLanded 并集）；
      实测 17 个 AC 全勾 ready 任务被移出 dispatchable
- [ ] AC2: **不替换**——taskWorkLanded 语义保留（落地未勾仍被抓）；勾了但工作未落地的任务不被误翻转
      （负控制：构造一个 AC 全勾但 Touches 文件不存在/符号不解析的任务 ⇒ 不报 not-yet-flipped）
- [ ] AC3: **池清空后**——dispatchable 数从 17+ 回落到真实可派发数（约 4-5）
- [ ] AC4: 与 gap-ready-pool-check-counts-merged-not-flipped-tasks-in-the-pool、gap-targeted-promotion
      交叉标注（同一池机制族：收尾信号/退回排除/定向晋级）

## Definition of Done

- [ ] AC1-AC4 实跑输出贴任务体（17→回落对照 + 负控制 + 并集不替换）

## Touches
- plugin/scripts/ready-pool-check.ts（notYetFlipped 加并列信号）
- plugin/scripts/task-status-drift-check.ts（countAcCheckboxes 复用/导出）
- plugin/test/ready-pool-check.test.mjs（AC2 负控制）
- tasks/gap-targeted-promotion-operation-does-not-exist.md（AC4 交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-08T11:5xZ
changed: 管理者三层诊断（驱动机制大问题）L1/L3——ready 池 61% AC 全勾未翻转，收尾信号 taskWorkLanded
  只读符号/触摸/历史不读勾选框。外层复核：17/21 实测、:519 三信号、countAcCheckboxes 已存在。立案。
