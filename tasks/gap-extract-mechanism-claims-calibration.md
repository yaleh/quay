---
id: gap-extract-mechanism-claims-calibration
title: "Calibrate extractMechanismClaims: merge coverage-pattern claims into
  single mechanisms"
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

`extractMechanismClaims` in `wiring-coverage-check.ts` counts each coverage item as an independent
mechanism — e.g., "8 phase boundaries" produces 8 mechanism claims instead of 1. This is the root
cause of 4 false `split-multi-mechanism` triggers on 2026-08-01 (DIR-124-A1b: 14 claims → 1
mechanism; DIR-124-A4: 16 findings → 1 mechanism).

**Fix:** identify adjacent claims in the same Proposal paragraph whose wording differs ONLY by
numeric/alphabetic labels (E1/E2/…/E8, AC1/AC2/…/ACn, phase-name enumeration) and merge them into
a single mechanism claim with a `coverageCount` field recording the multiplicity.

### Calibration targets (verified against real task data)

| Task | Current extraction | Correct extraction |
|---|---|---|
| DIR-124-A1b | 14 claims | 1 mechanism (instrumentation) |
| DIR-124-A4 | 16 findings | 1 mechanism (conformance checker) |
| DIR-124-B | 4 mechanisms | 4 mechanisms (CORRECT — no change) |
| DIR-124-A | 5 mechanisms | 5 mechanisms (CORRECT — no change) |
| DIR-126-D | 1 mechanism | 1 mechanism (CORRECT — no change) |

The calibration must NOT break correct extractions (DIR-124-B's RunIdentity/journal/cache/receipt
are genuinely independent — they differ in subsystem, not just labels).

### Merge rule

If N adjacent WIRING-CLAIM/mechanism claims share the same subsystem AND their text differs only
in:
1. Numeric/alpha enumeration (E1..E8, AC1..AC14, C1..C8)
2. Phase name enumeration (Verify/Prepared/Build/Audit/Gate/Reconcile/Land)
3. Mirror/file enumeration (execute-milestone.js vs prepare-milestone.js)

…then merge into 1 mechanism with `coverageCount: N`.

Claims that differ in MECHANISM (not just label) are NOT merged: "RunIdentity mint" vs "stage
journal store" vs "Verify cache" → 3 mechanisms.

## Acceptance Criteria

- [ ] AC1: DIR-124-A1b's 14 WIRING-CLAIMs merge to 1 mechanism (not 14)
- [ ] AC2: DIR-124-A4's 16 findings merge to 1 mechanism (not 16)
- [ ] AC3: DIR-124-B's 4 mechanisms remain 4 (no false merge)
- [ ] AC4: DIR-124-A's 5 mechanisms remain 5 (no false merge)
- [ ] AC5: DIR-126-A's 1 mechanism remains 1 (no degradation)
- [ ] AC6: Existing tests in `proposal-convergence.test.mjs` still pass
- [ ] AC7: merge rule is deterministic — same input always produces same mechanism count

## Definition of Done

- [ ] `extractMechanismClaims` (or the split-sentences pre-filter) in `wiring-coverage-check.ts` applies the merge rule
- [ ] Both mirrors byte-identical
- [ ] Tests cover: coverage-pattern merge (A1b), no-false-merge (B), edge cases (single claim, empty input)
- [ ] `checkSplitRecommendation` tests in `proposal-convergence.test.mjs` all pass

## Touches

- experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
- plugin/scripts/wiring-coverage-check.ts
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- plugin/test/proposal-convergence.test.mjs
