---
id: gap-prepare-milestone-epoch-scope-change-grants-full-review
title: prepare-milestone epoch blocks a corrected task body's full review — scope change should grant a fresh full-review allowance
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
  - human-steered
extra:
  schema: v1
---

**type:** execution

## Finding

`proposal-convergence.ts`'s epoch mechanism has `maxFullReviewsPerEpoch: 1` and
`maxNewEpochResetCount: 3`. When a prepare-milestone task's Proposal is corrected through
multiple ProposalReview/mechanism-inventory rounds (e.g. DIR-099-B went through 6
mechanism-inventory-invalid rounds), the epoch's full-review cap (1) is consumed and the
reset quota (3) is exhausted — so the CORRECTED body can never get a fresh full review.
The only paths left are COMMIT/SPLIT/OVERRIDE, and `--override-budget` grants only
minutes, not full-review allowance. Result: the orchestrator must manually author the plan
+ receipt (DIR-099-B precedent, 2026-08-01), bypassing the prepared-gate discipline.

Real case: DIR-099-B — 6 prepare attempts, all failing mechanism-inventory-invalid with
progressively narrower edge cases; body corrected each round; epoch then blocked the 7th
full review. DIR-103-A/B/C hit the same reset-exhaustion wall. Cost: ~2M tokens of prepare
attempts + a manual takeover per task.

**Root cause:** the epoch cannot distinguish "unchanged scope re-hitting the cap"
(correctly blocked — the DIR-120/M192 unbounded-restart protection) from "corrected scope
deserving a fresh review" (currently wrongly blocked). The epoch already tracks the
proposal/scope hash (`scopeHash` in the record); it just doesn't USE a hash change to
grant a fresh full-review allowance.

## Proposal

When the epoch's scope hash (proposal/body hash) changes since the last full review, reset
the `fullReviews` counter (grant a fresh full-review allowance for the NEW scope) WITHOUT
consuming a `--new-epoch` reset. The `maxFullReviewsPerEpoch` cap continues to bound
re-review of an UNCHANGED scope — the DIR-120 protection is untouched.

## Requested action

1. In `proposal-convergence.ts`: when recording/checking a full review, compare the current
   `scopeHash` to the epoch record's stored scope hash; if they differ, reset the
   `fullReviews` counter (the scope changed → the prior full review was of a different
   body; a fresh full review is legitimate). `maxNewEpochResetCount` is not consumed.
2. If `scopeHash` is UNCHANGED and `fullReviews >= maxFullReviewsPerEpoch`, keep the
   current fail-closed behavior (COMMIT/SPLIT/OVERRIDE).
3. RED/GREEN tests:
   - unchanged scope, fullReviews=1 → full review blocked (existing behavior preserved);
   - CHANGED scope, fullReviews=1 → full review GRANTED (new behavior), and the counter
     resets so the new scope gets its own full-review budget;
   - changed-scope-grant does not increment `resets` (no `--new-epoch` consumption);
   - changed scope can still be re-changed (scope-churn) — bounded by the same
     `maxNewEpochResetCount` for the EPOCH-level reset path, so unbounded scope-churn
     re-review is still prevented.
4. Confirm the DIR-120/M192 unbounded-restart protection still holds: a task whose body
   is NOT changed cannot trigger repeated full reviews.

## Acceptance Criteria

- [ ] A task whose body changed since its last full review gets a fresh full-review
  allowance without a `--new-epoch` reset (real before/after, not asserted).
- [ ] An unchanged-scope task at the full-review cap stays blocked (COMMIT/SPLIT/OVERRIDE)
  — the DIR-120 protection is regression-tested.
- [ ] The changed-scope grant does not increment `resets`.
- [ ] A re-corrected body after a grant (further correction) can get another grant — but
  bounded so unbounded scope-churn cannot bypass `maxFullReviewsPerEpoch` indefinitely.
- [ ] Tests: `proposal-convergence.test.mjs` RED/GREEN for all four cases.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real prepare-milestone task that previously required manual takeover (e.g. the
  DIR-099-B/DIR-103-A/B/C class) now converges through the normal pipeline with a changed
  scope.
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Does a corrected body get a fresh full review without a reset, while an unchanged body
   stays capped?
2. Is the DIR-120 unbounded-restart protection regression-tested as preserved?

## Touches

- `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`
- `plugin/scripts/proposal-convergence.ts`
- `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
- `plugin/test/proposal-convergence.test.mjs`


- `docs/plans/M233-gap-epoch-scope.md`