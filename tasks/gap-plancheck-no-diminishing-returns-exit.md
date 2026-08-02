---
id: gap-plancheck-no-diminishing-returns-exit
title: "No diminishing-returns exit: a round that fails to reduce blocking
  findings still burns the remaining round budget"
status: ready
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

Neither PlanCheck nor ProposalReview detects "this round did not improve on the last one." The
only terminators are success (unreachable — see
[[gap-plancheck-blocking-only-convergence]]) and the round cap. A revision that fixes nothing
still consumes a full round, and the loop runs to the cap regardless.

**Evidence:** 93% of PlanCheck runs reach round 3. If rounds were converging, the distribution
would decay (many stop at 1, fewer at 2, fewest at 3). A flat 57/56/53 means rounds are being
consumed without discriminating between "making progress" and "spinning."

## Chosen mechanism

Extend `planCheckNextAction` (from [[gap-plancheck-blocking-only-convergence]]) with an optional
`priorBlocking` parameter. When the current round's blocking count is >= the previous round's,
the revision did not reduce the blocking set — stop immediately rather than burning remaining
rounds.

```
if (Number.isFinite(priorBlocking) && blocking >= priorBlocking && round >= 2) {
  return { action: 'stop-needs-human', code: 'plancheck-diminishing-returns' }
}
```

Guard conditions, each deliberate:

- `round >= 2` — round 1 has no prior to compare against; the first revision always gets a fair
  second attempt
- `Number.isFinite(priorBlocking)` — absent prior (first round, or legacy scalar path with no
  tracking) never triggers the exit
- `>=` not `>` — a round that holds steady is as non-convergent as one that regresses

## Acceptance Criteria

- [ ] AC1: `priorBlocking` accepted as an optional param on `planCheckNextAction`
- [ ] AC2: `blocking >= priorBlocking` and `round >= 2` → `stop-needs-human`, code `plancheck-diminishing-returns`
- [ ] AC3: `blocking < priorBlocking` → normal `dispatch-plancheck-round` (progress continues)
- [ ] AC4: `round === 1` never triggers the exit regardless of `priorBlocking`
- [ ] AC5: `priorBlocking` null/undefined never triggers the exit (legacy path safe)
- [ ] AC6: zero-blocking still wins — `stop-plan-checked` takes precedence over the exit
- [ ] AC7: `prepare-milestone.js` tracks the prior round's blocking count and passes it
- [ ] AC8: both mirrors byte-identical

## Definition of Done

- [ ] `planCheckNextAction` accepts and honors `priorBlocking`, both mirrors
- [ ] PlanCheck loop tracks prior blocking count across rounds, both workflow mirrors
- [ ] Tests cover AC2-AC6
- [ ] `scripts/test.sh` green

## Touches

- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- plugin/test/proposal-convergence.test.mjs
- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
