---
id: gap-plancheck-blocking-only-convergence
title: "PlanCheck converges on zero findings (unreachable) instead of zero
  blocking findings — 93% of tasks burn all 3 rounds, 79% fail"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---

**type:** execution

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
