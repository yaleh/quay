---
id: DIR-124-F
title: "Runtime-contract ground-truth registry for PlanAuthor/PlanCheck:
  single-source repo facts + grounded-fact learning loop"
status: done
labels:
  - directive
  - human-steered
parent: DIR-124
children:
  - DIR-124-F-core
  - DIR-124-F-plancheck
  - DIR-124-F-learn
extra:
  schema: v1
---

**type:** execution

**ADR-022 关闭（2026-08-09，manager 代写，人 17:4x 裁定关闭，随父任务 DIR-124 一并关闭）**

原标题：Runtime-contract ground-truth registry for PlanAuthor/PlanCheck: single-source repo facts +
grounded-fact learning loop。三个子任务 `DIR-124-F-core`/`DIR-124-F-plancheck`/`DIR-124-F-learn`
的载体是 `prepare-milestone.js` 的 PlanAuthor/PlanCheck 阶段——**该文件已被 ADR-022（2026-08-03
accepted）物理删除**，两层 fast-mode 用 `task-contract-check.ts` + subagent REFUTE 轮替代了
ProposalReview/PlanCheck，本任务群的注入点不复存在。

意见：见父任务 `DIR-124` 关闭说明。「grounded facts 重复发现、需要单一权威事实源」这个问题本身仍然
成立（`orchestration/manager-obligation-ledger.jsonl` 今晚新立的义务生成器就是同类思路的另一种落地
——用可推导的判据取代散文重复），若要落地应针对当前 fast-mode 的 task-contract-check/REFUTE 轮重新
提案，而不是复用为已删除的 PlanCheck 设计的 registry 契约。

全文见 git 历史（`git log -p -- tasks/DIR-124-F.md`）。

## Proposal

Mechanize the recurring "grounded facts" problem: PlanAuthor/PlanCheck repeatedly fail on
the SAME repo-runtime-contract facts (CLI binary path, Node coverage output format, Touches
matching rules, provider runtime defaults, shared-module signatures), each task paying a
failed-PlanCheck-round + per-task grounding-fact fix. Build a **versioned, hash-bound
`GroundTruthRegistry`** of repo-invariant facts that `prepare-milestone.js` injects into the
PlanAuthor and PlanCheck prompts, and a **learning loop** that promotes `grounded-fact-gap`
PlanCheck findings into the registry (with a version bump) so a fact is never re-discovered
by a later task.

## Touches
- tasks/DIR-124-F.md（自身文件）
