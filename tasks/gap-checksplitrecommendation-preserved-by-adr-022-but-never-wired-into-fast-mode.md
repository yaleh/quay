---
id: gap-checksplitrecommendation-preserved-by-adr-022-but-never-wired-into-fast-mode
title: "ADR-022 preserved checkSplitRecommendation explicitly because fast-mode reuses it, and CLAUDE.md documents its routing table as current policy — but zero fast-mode code actually calls it"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

Found while ruling on whether `gap-recursive-guard-only-covers-multi-mechanism` (and the two
sibling `gap-plancheck-*` tasks) should reopen against fast-mode's own mechanisms
(2026-08-04, outer session, human-delegated architecture judgment).

`adr/ADR-022-retire-the-classic-milestone-loop-two-layer-is-the-sole-mode.md`'s "明确不在退役范围
内" section explicitly preserves `checkSplitRecommendation` (alongside `planCheckNextAction` /
`checkTouchesPair`) with the stated reason: **"仍被快速模式复用的判定函数"** ("still reused by
fast mode"). `CLAUDE.md`'s "Split-decision routing policy (DIR-124-A1b)" section documents
`checkSplitRecommendation`'s codes (`split-multi-mechanism`, `split-touch-set-too-large`,
`split-subsystem-blocking-cluster`, `split-recursive-guard`) as a live routing table the
orchestrator "MUST route by," in present tense, not marked retired.

**Real-run evidence — it is not actually called anywhere:**

```
$ grep -rn "checkSplitRecommendation" --include="*.ts" --include="*.md" . | grep -v node_modules | grep -v "/test/" | grep -v "^tasks/"
CLAUDE.md:80        (mentioned in prose, "branch-dense pure functions" list)
CLAUDE.md:159       (the routing-table paragraph itself)
CLAUDE.md:176       (calibration note)
experiments/.../proposal-convergence.ts:133,217,239,276   (the definition itself + internal refs)
plugin/scripts/proposal-convergence.ts:217,239,276        (mirror, same)
adr/ADR-022-...md:83   (the preservation justification)
docs/analysis/*.md, docs/proposals/*.md, adr/ADR-021-...md   (design docs, prose only)
milestones/M199, M206, M193   (historical audit/iteration records, not live code)
```

Zero hits in any script that runs as part of `fast-mode-loop-tick.md`'s tick steps, any skill
(`plugin/skills/*/SKILL.md`), or `plugin/scripts/task-contract-check.ts` /
`concurrent-batch-scheduler.ts` / `it0-split-or-commit-check.ts` (the actual live dispatch-
eligibility chain). The function is exported, correctly implemented, and unit-tested in isolation
— but nothing in the real fast-mode dispatch or task-authoring path ever calls it.

**Consequence**: `CLAUDE.md`'s split-decision routing table currently describes a decision
procedure that a human (or an agent following the doc) is expected to run BY HAND when authoring
a task — there is no mechanical enforcement that a `> 2`-mechanism task actually gets flagged
`split-multi-mechanism` before being authored/dispatched. This is doc/code drift of the same
family this repo has repeatedly flagged tonight (a mechanism is "preserved" but nothing exercises
it — indistinguishable from dead code from the dispatch path's point of view, same shape as
`gap-checkers-have-never-been-shown-to-fail`).

## Chosen mechanism

**Two candidates, not mutually exclusive — a human should choose (or defer both if there's no
current evidence of harm from the gap, matching this session's `gap-plancheck-*` rulings):**

1. **Wire it in**: call `checkSplitRecommendation` at task-authoring time (e.g. `quay:author`'s
   todo→ready gate, or `task-contract-check.ts`) so the routing table in CLAUDE.md becomes
   mechanically enforced, not a manual-reading-required policy doc.
2. **Mark the routing table aspirational**: if wiring it in isn't currently worth the cost, update
   CLAUDE.md's split-decision routing policy section to say so explicitly, rather than reading as
   live enforced policy when it isn't — this repo's own recurring lesson is that undocumented gaps
   between "described as current" and "actually wired" cause real confusion (this very task exists
   because three OTHER tasks assumed the wiring existed).

**Not doing**: not deciding which of the two here — that's the human call this task exists to
route to; not bundling this with `gap-recursive-guard-only-covers-multi-mechanism`'s narrow
recursion-depth bug fix (fixing a bug in an uncalled function is out of order until this is
resolved).

## Acceptance Criteria

- [ ] AC1: human/task decides wire-in vs. mark-aspirational (real ruling recorded in this task
      body, not left implicit)
- [ ] AC2: if wire-in — `checkSplitRecommendation` has a real, live, non-test caller in the
      fast-mode dispatch or task-authoring path (grep evidence pasted, exit criterion same shape
      as the one that found the gap)
- [ ] AC3: if mark-aspirational — `CLAUDE.md`'s split-decision routing policy section is edited to
      say the table is not currently mechanically enforced, with a pointer to this task
- [ ] AC4: `gap-recursive-guard-only-covers-multi-mechanism`'s narrow bug-fix scope is re-evaluated
      once AC1 lands — dispatchable if wire-in was chosen, stays `needs-human` if aspirational

## Definition of Done

- [ ] AC1-AC3 evidence pasted into this task body
- [ ] `gap-recursive-guard-only-covers-multi-mechanism`'s status updated per AC4's outcome

## Touches

- CLAUDE.md
- plugin/scripts/task-contract-check.ts (if wire-in chosen)
- plugin/skills/author/SKILL.md or equivalent todo→ready gate (if wire-in chosen)

## Dispatch review

reviewer: none
at: 2026-08-04T10:5xZ
changed: 无（外层建任务，裁定 gap-recursive-guard 时发现的更基础缺口；未经正式闸口审查）
