---
id: gap-doc-develop-sync-semantic-conflict-resolution
title: main/manager-doc↔develop 同步的语义冲突消解——替代 git merge 回退（develop 权威）
status: todo
labels:
  - gap
parent: gap-main-manager-doc-doc-only-ff-only-tracking
children: []
extra: {}
---
**type:** execution

## Proposal

`propagateDocBranchToDevelop`（driver-filters.ts:207）在 main/manager-doc 与 develop 分叉时走 `git merge develop` 回退，结构上不可用：实证 2026-08-30 近 30 天 1795 次 `Merge branch 'develop' into main/manager-doc` 全由该 fallback 产生，develop-only 39 / main/manager-doc-only 13 分叉永续。gap-ff-propagate 已立「分叉是设计不是病根」，gap-main-manager-doc 已立「inert 直落 develop / non-inert 汇聚 main/manager-doc + ff-only 追踪」。**本任务是两者的上位通用化**：对「必须同步但 ff 不成立」的残余分叉，不做 dumb git merge，改做**语义消解**——任务状态按确定性规则、代码/文档按 LLM 语义合并 + guard。

**原则（manager 2026-08-30 提）**：**必须同步（must-sync）、develop 权威（develop-authority-wins）**。

- **问题面**：propagate 的 git merge 回退静默失败于分叉（fallback 每次冲突，非「同步成功」同形）。
- **消解按面分派**：tasks/*.md 走确定性规则（status 取 develop 权威：`done > needs-human > ready > todo`）；code/docs 走 LLM 语义合并（base=develop，doc 侧变更语义叠加）。
- **guard**：任务状态永不进 LLM；LLM 合并结果过 anti-drift / typecheck / scoped-gate 迭代，红则退回 needs-human 不静默落。
- **接线**：promotion-driver 与 worker-driver 两条 sync 路径都改走语义消解，删除 git merge 回退。

**与 gap-main-manager-doc 的分工**：该任务定**分支模型**（inert 直落 / non-inert 汇聚 / ff-only 追踪 + guard——最小化分叉）；本任务定**残余分叉的消解语义**（分叉发生后怎么融，不靠 git merge）。非重复：前者 AC3 是「非 ff 报红」，本任务是「非 ff 语义消解」，后者是前者的下一步。

## Plan

1. 语义消解器落地：分叉时按面分派——tasks/*.md 确定性规则（status 取 develop 权威：done > needs-human > ready > todo，永不进 LLM）；code/docs LLM 语义合并（base=develop + doc 侧变更叠加）。
2. guard 接线：任务状态永不进 LLM（结构上分派，非约定）；LLM 合并结果过 anti-drift / typecheck / scoped-gate 迭代，红则标 needs-human。
3. 接线：promotion-driver 与 worker-driver 的 sync 调用点改走语义消解，删除 `git merge develop` 回退。
4. 负控制：①造一次 tasks 状态分叉（develop done vs doc todo）验证确定性规则取 done 且无 LLM 调用；②造一次 docs 分叉验证 LLM 合并 + guard 迭代绿。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：git merge 回退删除——grep 无 `git merge develop` 兜底，分叉时不再静默 merge；（⛔ 仍 merge-fallback ⇒ 假）。
- [ ] AC2（能取假，确定性规则）：tasks 状态分叉（develop done / doc todo）消解为 done，且该路径无 LLM 调用（grep 状态消解函数不调 LLM）；（⛔ 状态进 LLM / 取 todo ⇒ 假）。
- [ ] AC3（能取假，guard）：docs/code 语义合并后过 anti-drift + typecheck + scoped-gate 迭代绿；红则标 needs-human 不静默落 develop；（⛔ 合并结果红 suite 仍落 ⇒ 假）。
- [ ] AC4（能取假，develop 权威）：消解不丢失 develop 独有提交——develop-only 提交消解后仍在 `git log develop`，develop 侧内容不被 doc 侧静默覆盖；（⛔ doc 覆盖 develop 独有提交 ⇒ 假）。
- [ ] AC5（能取假，双驱动接线）：promotion-driver 与 worker-driver 的 sync 调用点都走语义消解（grep 两处）；（⛔ 任一处仍走旧 propagate ⇒ 假）。

## Definition of Done

语义消解器落 develop；git merge 回退删除；确定性规则（任务状态）+ LLM 合并（code/docs）+ guard 接线；promotion-driver / worker-driver 双路径走语义消解；AC1-AC5 全勾；一次 tasks 状态分叉负控制、一次 docs 分叉负控制。

## Touches

- plugin/scripts/driver-filters.ts（propagateDocBranchToDevelop 的 merge 回退 → 语义消解）
- plugin/scripts/promotion-driver.ts（sync 调用点改走语义消解）
- plugin/scripts/worker-driver.ts（sync 调用点改走语义消解）
- tasks/gap-doc-develop-sync-semantic-conflict-resolution.md（自身）
