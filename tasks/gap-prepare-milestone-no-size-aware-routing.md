---
id: gap-prepare-milestone-no-size-aware-routing
title: prepare-milestone applies uniform full Proposal+Plan synthesis to every task regardless of implementation scale
status: superseded
labels:
  - gap
  - defect
  - human-steered
parent: null
children:
  - gap-prepare-milestone-no-size-aware-routing-A
  - gap-prepare-milestone-no-size-aware-routing-B
  - gap-prepare-milestone-no-size-aware-routing-C
extra:
  schema: v1
  superseded: true
  superseded_at: 2026-08-12
---

**type:** execution
> **SUPERSEDED / 作废（人 2026-08-12 00:4x 裁定，B 组）**：本任务引用 ADR-022 已物理删除的机制（prepare-milestone.js / execute-milestone.js 等），剩余 AC 要求针对已被删除的 pipeline 取证，**前提已不存在**——不是「完成」是「作废」。历史记录保留，不重开。引用已删机制：prepare-milestone.js + execute-milestone.js。

## Proposal

Add size-aware routing to prepare-milestone so small tasks don't pay the full Proposal+Plan
cost.

**Split 2026-08-01 (DIR-026 SPLIT-OR-COMMIT):** a real `prepare-milestone.js`
`ProposalReview` returned `split-multi-mechanism` (3 independently landable mechanisms >
2), `repairable: false`, with real findings (AC5 Verify-consumption had no
execute-milestone.js touch; proofScale classified but never affecting routing; tier
threshold conflict ~800 vs M-501-900; calibration count deviation). Parent completion is
exactly the completion of the children:

1. [[gap-prepare-milestone-no-size-aware-routing-A]] — size estimation + fast-lane routing
   (estimateTaskSize + PrepareRoutingDecision; proofScale genuinely gates routing;
   thresholds deferred to DIR-124-D).
2. [[gap-prepare-milestone-no-size-aware-routing-B]] — fast-lane execution manifest +
   execute-milestone Verify consumption (closes the AC5 Touches gap).
3. [[gap-prepare-milestone-no-size-aware-routing-C]] — calibration + rollout (shadow-mode,
   flag-gated auto-enable, reviewer findings in ledger).

This parent is not independently SELECTable — each child carries its own full
Proposal/Plan/AC/DoD and is dispatched on its own.

## Finding

The `prepare-milestone` workflow applies one nearly fixed-cost pipeline to every task:
competing ProposalAuthors → Adjudicate → ProposalReview → PlanAuthor → PlanCheck →
receipt. The 2026-07-31→08-01 product batch (S-size tasks through full-lane prepare)
showed this cost asymmetry sharply. The sizing proposal
(`docs/proposals/quay-milestone-workflow-task-sizing-and-adaptive-execution.md`)
establishes the two-dimension estimator and fast-lane/full-lane split. Full detail in each
child's Finding.

## Requested action

Execute the three children in order; each is independently prepared + executed with its own
real proof and independent audit. Do not promote the parent to `done` until all three
children are `done`.

## Acceptance Criteria

- [ ] gap-size-A is `done`: two-dimension routing where proofScale genuinely gates
  fast-lane; thresholds deferred to DIR-124-D.
- [ ] gap-size-B is `done`: fast-lane execution manifest consumed by execute-milestone
  Verify.
- [ ] gap-size-C is `done`: calibration/rollout with flag-gated auto-enable and durable
  reviewer findings.
- [ ] Parent/child lifecycle gate passes: this parent is `done` iff all three children are
  `done`.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] All three children are real-landed and independently audited.
- [ ] `it0-split-or-commit-check.ts .` reports no PARENT-DONE-IFF-CHILDREN violation.

## Human verification

1. Are all three children real-landed and independently audited?
2. Was this parent kept `todo` throughout, promoted only after all three are done?

## Touches
- tasks/gap-prepare-milestone-no-size-aware-routing.md（自身文件：勾 AC + 贴 invoke 证据授权）


- `tasks/gap-prepare-milestone-no-size-aware-routing-A.md`
- `tasks/gap-prepare-milestone-no-size-aware-routing-B.md`
- `tasks/gap-prepare-milestone-no-size-aware-routing-C.md`

## Execution disposition (2026-08-06, inner-layer dispatch — NO ACs checked)

This task was promoted to `ready` (commit `bbf85ea9`, pool 4<floor 12) and dispatched. On
inspection the premise is VOID: the entire mechanism it modifies — `prepare-milestone.js`
and `execute-milestone.js` — was **physically deleted on 2026-08-03 under ADR-022**
(classic milestone loop retired; the two-layer fast mode is the sole mode). Verified
against `master` (HEAD `bbf85ea9`): neither file exists in `git ls-tree -r HEAD`. The
`docs/plans/M239-…-a.md` plan and `milestones/M239/` sidecars exist, but the production
workflow they wire into is gone. **No AC checkbox is checkable and none was checked**;
status left `ready` per dispatch instructions. The outer loop should mark this
`needs-human` / superseded (the review-cadence task's AC8 regression control is designed
to flag exactly this class).

**Mechanical evidence (real invoke, this dispatch):**

1. `strategic-doc-staleness-check.ts --pool-candidate gap-prepare-milestone-no-size-aware-routing`
   (the AC8 regression control built by `gap-establish-daily-review-cadence-mechanism`):
   ```
   FLAGGED: 2 stale reference(s) to deleted classic-pipeline scripts (unannotated)
     tasks/gap-prepare-milestone-no-size-aware-routing.md:25  [prepare-milestone.js]
     tasks/gap-prepare-milestone-no-size-aware-routing.md:28  [execute-milestone.js]
   FAIL: candidate references a retired mechanism
   ```

2. `select-tests-for-touches.ts --task gap-prepare-milestone-no-size-aware-routing --allow-thin`:
   ```
   task gap-prepare-milestone-no-size-aware-routing: 0 test file(s)
   unresolved (4): …A.md …B.md …C.md …md — no */test/*.test.mjs found
   coverage: 0.00 (0/4 Touches resolved)
   warning: test-selection-thin
   ```

3. Mandated scoped verification `scripts/test.sh --for-task gap-prepare-milestone-no-size-aware-routing --allow-thin`
   → EXIT=0 but **zero tests run** ("nothing to run, full suite still runs at fan-in") —
   a hollow green; the only real check is `task-contract-check --strict-subset` on the four
   task files ("no violations").

4. Children `…-B` and `…-C` are **PAUSED** (2026-08-02, `blocked-by:
   prepare-pipeline-reduction`), so parent AC2/AC3 (B and C done) are not satisfiable
   regardless of implementation.

5. Child `…-A` was already fully implemented + audited on stranded branch
   `milestone/M239/iteration-0` (commit `b550ef24`, audit `778b0a0a`) and never merged —
   the reason it did not land is precisely ADR-022 retiring the pipeline. Re-implementing
   it here would duplicate work on a deleted mechanism (the "touches false-resolve" the
   outer loop warned about at `88a49faa`).

**Disposition:** implement nothing against a deleted pipeline; document + return to the
outer loop for re-adjudication.
