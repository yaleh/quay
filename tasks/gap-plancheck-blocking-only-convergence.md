---
id: gap-plancheck-blocking-only-convergence
title: "PlanCheck converges on zero findings (unreachable) instead of zero
  blocking findings — 93% of tasks burn all 3 rounds, 79% fail"
status: superseded
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
  superseded: true
  superseded_at: 2026-08-12
---

**type:** execution
> **SUPERSEDED / 作废（人 2026-08-12 00:4x 裁定，B 组）**：本任务引用 ADR-022 已物理删除的机制（prepare-milestone.js / execute-milestone.js 等），剩余 AC 要求针对已被删除的 pipeline 取证，**前提已不存在**——不是「完成」是「作废」。历史记录保留，不重开。引用已删机制：prepare-milestone.js。

**ADR-022 RE-TRIAGE (2026-08-04, gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files):**
status `ready` → `needs-human`. The CORE mechanism of this task LANDED and is unit-tested:
`planCheckNextAction` (blocking-only convergence) was implemented 2026-08-02 in the retained
`proposal-convergence.ts` (both mirrors) and is exercised by `proposal-convergence.test.mjs`
(AC1-AC6 pass). What remains — AC7 "`prepare-milestone.js` PlanCheck loop consumes the function in
both mirrors" — targets the classic `prepare-milestone.js` PlanCheck loop that ADR-022 retired and
physically deleted at `gap-retire-the-prepare-execute-pipeline-cluster` (2026-08-03); the two-layer
fast mode replaced PlanCheck with `task-contract-check.ts` + subagent REFUTE rounds, so there is no
PlanCheck loop left to wire into. Whether the blocking-only-convergence rule should be applied to
the fast-mode loop's OWN convergence is a human scoping decision. Real-run resolve evidence
(worktree branch, 2026-08-04):
```
$ node --no-warnings --experimental-strip-types plugin/scripts/touches-orthogonality-check.ts --resolve tasks/gap-plancheck-blocking-only-convergence.md --root "$(pwd)"
  ok: experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
  ok: plugin/scripts/proposal-convergence.ts
  ok: experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
  MISSING: plugin/test/proposal-convergence.test.mjs
  MISSING: .claude/workflows/prepare-milestone.js
  MISSING: plugin/workflows/prepare-milestone.js
RESOLVE tasks/gap-plancheck-blocking-only-convergence.md: 3/6 non-(new) touches missing — resolves (dispatchable)
```
(The resolve check does not flag this body — proposal-convergence.ts is majority-present — but the
two missing `prepare-milestone.js` entries are the ONLY remaining AC's wiring target, which is
deleted. Disposition is by Proposal/AC re-scope, not by the majority-missing threshold.)

**OUTER RULING (2026-08-04, judgment delegated by the human):** **Stay `needs-human`. Not wiring
into fast-mode's convergence mechanism at this time.**

Checked fast-mode's actual REFUTE-round behavior against this task's specific concern (PlanCheck
requiring ALL findings — including non-blocking ones — to reach zero before converging, causing
93%/79% round-budget exhaustion under the classic loop) rather than assuming it transfers. Real
evidence from tonight's own queue history: the `inventory` task's fan-in explicitly recorded
**"REFUTE 1 轮 10 MINOR 全闭（0 阻塞）"** — fast-mode's REFUTE rounds already distinguish
blocking from non-blocking (MINOR) findings and converge on zero-BLOCKING, not zero-total, via a
mechanism independently evolved for the subagent-REFUTE shape rather than by calling
`planCheckNextAction`. Wiring the old typed function in now would mean maintaining two parallel
implementations of the same policy, which cuts against this repo's own single-source-of-truth
principle. **Not reopening without fresh evidence that fast-mode's REFUTE rounds actually hit the
unreachable-convergence pathology this task was built to prevent** — the one concrete data point
available points the other way.

## Proposal

PlanCheck's success condition is `F_i = 0` — zero findings of any severity. A grounded reviewer
can always find a non-blocking improvement (wording, cross-reference, an optional extra test), so
`F_i = 0` is effectively unreachable and the round cap becomes the only terminator — and hitting
the cap is a FAILURE terminal.

**Evidence (232 dispatches):**

| Phase | Count |
|---|---|
| PlanCheck-round-1 | 57 |
| PlanCheck-round-2 | 56 |
| PlanCheck-round-3 | 53 |

93% of tasks burn all three rounds; 45 of 57 (79%) end in `plancheck-rounds-exceeded`.
Cumulative cost: **23.1 hours — 31% of all prepare-milestone wall-clock**, and
`plancheck-rounds-exceeded` alone accounts for **31.6 hours (43%)** of total prepare time.

ProposalReview does NOT have this defect: `nextAction` stops at
`blockingOpen(ledger).length === 0` (proposal-convergence.ts:256). PlanCheck never inherited it.

## Chosen mechanism

A pure decision function `planCheckNextAction({round, findings, blockingFindings, maxRounds})`
mirroring `nextAction`'s shape, plus its consumption in `prepare-milestone.js`'s PlanCheck loop.

**Blocking determination with legacy tolerance** — PlanCheck's current output schema is scalar
(`{findings: <count>, findingsDetail: <string>}`); typed findings are DIR-124-F-plancheck's scope.
This task must work with BOTH:

- If `blockingFindings` is a finite number (typed path, future) → converge at
  `blockingFindings === 0`
- If `blockingFindings` is null/undefined (legacy scalar path, today) → converge at
  `findings === 0` (existing behavior, zero regression)

This makes the mechanism land NOW and get strictly better when typed findings arrive — no
dependency inversion, no waiting.

## Acceptance Criteria

- [ ] AC1: `planCheckNextAction` exported as a pure function from `proposal-convergence.ts`
- [ ] AC2: `blockingFindings === 0` → `{action: 'stop-plan-checked'}` even when `findings > 0`
- [ ] AC3: `blockingFindings > 0` and `round < maxRounds` → `{action: 'dispatch-plancheck-round'}`
- [ ] AC4: `blockingFindings > 0` and `round >= maxRounds` → `{action: 'stop-needs-human', code: 'plancheck-rounds-exceeded'}`
- [ ] AC5: legacy path (`blockingFindings` null) + `findings === 0` → `stop-plan-checked`
- [ ] AC6: legacy path + `findings > 0` + round < max → `dispatch-plancheck-round` (unchanged)
- [ ] AC7: `prepare-milestone.js` PlanCheck loop consumes the function in both mirrors
- [ ] AC8: both `proposal-convergence.ts` mirrors byte-identical; both workflow mirrors byte-identical

## Definition of Done

- [ ] `planCheckNextAction` implemented + exported, both mirrors
- [ ] PlanCheck loop in both `prepare-milestone.js` mirrors consumes it
- [ ] Tests cover AC2-AC6
- [ ] `scripts/test.sh` green

## Touches

- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- plugin/test/proposal-convergence.test.mjs
- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
