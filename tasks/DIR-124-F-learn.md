---
id: DIR-124-F-learn
title: "Learning loop: promote grounded-fact-gap PlanCheck findings into the
  GroundTruthRegistry"
status: done
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-124-F
children: []
extra:
  schema: v1
---

**type:** execution

**ADR-022 关闭（2026-08-09，manager 代写，人 17:4x 裁定关闭，随父任务 DIR-124-F 一并关闭）**

原为 DIR-124-F 三个子任务之一（学习回路——grounded-fact-gap 分类经 finding ledger 晋级）。依赖
`DIR-124-F-plancheck` 的 typed findings 输出 + `prepare-milestone.js` 的 PlanCheck 阶段——**载体已
被 ADR-022（2026-08-03 accepted）物理删除**。

意见：见父任务 `DIR-124-F` 关闭说明。

全文见 git 历史（`git log -p -- tasks/DIR-124-F-learn.md`）。

## Proposal

Close the loop: when PlanCheck returns a `grounded-fact-gap` finding (per F-plancheck's typed
classification), mechanically promote it into the GroundTruthRegistry (F-core) with a version bump.
The promotion is mechanically validated (category whitelist, duplicate exact-match, non-blocking on
failure). An already-registered fact that appears as a PlanCheck finding is an injection defect
(registry fact not reaching PlanAuthor prompt), not a new discovery.

Depends on DIR-124-F-core (registry CLI) and DIR-124-F-plancheck (typed findings). 1 mechanism.

## Touches
- tasks/DIR-124-F-learn.md（自身文件）
