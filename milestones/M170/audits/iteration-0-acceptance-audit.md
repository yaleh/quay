# DIR-066-B Adversarial Acceptance Audit -- Iteration 0 (Re-verification)

**Audit session id:** 890af9ef-77fb-4a3c-9673-01ab2951058b

**Date:** 2026-07-26
**Charter:** `experiments/quay-perpetual-stream/charters/M170-dir066-b-dquota-wiring.md`
**Task:** DIR-066-B
**Verdict:** NO REFUTATION FOUND

## Context

This is a RE-VERIFICATION audit. The original independent adversarial audit (2026-07-23) returned CONCERNS: one undisclosed defect found -- `experiments/quay-perpetual-stream/scripts/governance-product-ratio-check.ts` was NOT touched by the DIR-066 land commit; it still exported `haltInput`, returned `{halt:true}`, exited 1, and printed "HALT-RECOMMENDED input" on breach. Only OUTER-LOOP.md's prose had been updated. The fix was applied same-pass (commit `91c6206`), and the DoD box for that claim was left unticked pending audit re-confirmation.

This iteration verifies the fix is in place and closes the escrow.

## AC Satisfaction

### AC-1: No governance:product HALT-RECOMMENDED in OUTER-LOOP.md
**VERIFIED.** `grep -n 'HALT-RECOMMENDED' OUTER-LOOP.md` output:
- Line 185: `halt_self` function signature return type (not a clause)
- Line 195: `slope<threshold → HALT-RECOMMENDED` -- VT-slope hard-halt (DIR-038-A, should remain)
- Line 200: `convergence failure → HALT-RECOMMENDED directly` -- VT-slope convergence guard
- Line 202: `breach ¬trip HALT-RECOMMENDED` -- explicit informational-only note about governance:product

No governance:product-ratio→HALT-RECOMMENDED clause remains. DIR-038-B retired. PASSED.

### AC-2: SELECT step 1 describes Round-1 D-quota composition
**VERIFIED.** `grep -n -E 'deliverable|streak|composeShortlist|shortlist' OUTER-LOOP.md` shows:
- Lines 22-51: deliverable-governor preflight integration, deliverable:yes|no (丙) classification, streak tracking with explore/arch-audit exemption, composeShortlist with floor=min(1,streak/6), S_max=4, S∈[1,4], pure-soft DELIVERABLE-STARVATION signal, Round 2 explicitly unchanged. PASSED.

### AC-3: VT-slope hard-halt input preserved
**VERIFIED.** Line 187: `slope = invoke("scripts/rolling-slope-check.ts") -- DIR-038-A; K≥5 incl. zero-Δv`. Line 195: `| slope<threshold → HALT-RECOMMENDED`. The VT-slope hard-halt input is present and unchanged. Rolling-slope selfcheck: 4/4 PASS. PASSED.

### AC-4: Golden-replay selfchecks green
**VERIFIED.** All cited selfchecks pass:
- DoD fixture selfcheck: 17/17 PASS
- Governance-product-ratio selfcheck: 4/4 PASS
- Rolling-slope selfcheck: 4/4 PASS
- Loadbearing test gate selfcheck: 3/3 PASS
- Deliverable-governor tests: 14/14 PASS

No changes to chart-1 fixtures. PASSED.

### AC-5: split-or-commit check passes
**VERIFIED.** `node scripts/it0-split-or-commit-check.ts .` output: "PASS: 428 task(s) checked -- no split-or-commit violations". PASSED.

## DoD Satisfaction

### DoD-1: chart-2/VT untouched; diff scoped
**VERIFIED.** `git diff 181696d~1..181696d -- OUTER-LOOP.md` shows changes ONLY in:
1. SELECT step 1: added "Round-1 deliverable governor (DIR-066)" paragraph
2. Self-halt block: removed governance:product→HALT-RECOMMENDED, demoted to informational

No chart-2, VT, or other files touched in the original DIR-066 land diff. PASSED.

### DoD-2: REAL milestone's SELECT used the governor
**VERIFIED.** M126 SELECT (2026-07-23) recorded: streak=2, floor=0.333, dSeats=1, nSeats=3, shortlist S=2 [exp5-M-PRODUCTIZED-DELIVERY-A(D), DIR-063-A(N)], starvation=false. The governor constrained the choice -- the D-seat put PRODUCTIZED-DELIVERY-A in the "candidates considered" set. PASSED. (Already ticked by prior audit.)

### DoD-3: governance:product halt removed, cannot fire
**VERIFIED.** Fix in commit `91c6206` confirmed on master:
- API renamed: `haltInput→evaluateRatio`, `HaltResult→RatioReport`, field `halt→breach`
- Breach message: "INFORMATIONAL ONLY since DIR-066 (2026-07-23): reported at a checkpoint, does NOT trip HALT-RECOMMENDED"
- Selfcheck: 4/4 PASS
- Unit tests: 11/11 PASS
- OUTER-LOOP.md lines 201-202: explicit `¬trip HALT-RECOMMENDED`

The executable instrument no longer emits "HALT-RECOMMENDED input". PASSED. Escrow condition (b) CLOSED.

### DoD-4: Authored human-steered
**VERIFIED.** Task carries `label:human-steered`. Execution record confirms `.halt` window (方案乙). Golden-replay confirmed by all selfchecks. Independent adversarial audit performed (2026-07-23 CONCERNS → fix → re-verified 2026-07-26). PASSED.

### DoD-5: DIR-066 dirStatus:applied, DIR-065 superseded
**VERIFIED.** `quay task_get DIR-066` → `dirStatus: applied`. `quay task_get DIR-065` → `dirStatus: superseded`, body cites DIR-066 as superseding directive. PASSED.

### DoD-6: it0 DoD meta-enforcer passes
**VERIFIED.** `it0-dod-check.sh DIR-066-B` exits 0, all 12 clauses PASS. PASSED.

## Mechanical Gate

`bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-066-B M170-dir066-b-dquota-wiring.md /tmp/m170-absorb-entry.md`: **PASS** -- all 12 clauses satisfied, no undeclared self-exemption.

## Deviation Log

No new deviations found. The previous CONCERNS finding (governance-product-ratio-check.ts still emitting HALT-RECOMMENDED text) is **verified-eliminated** per the evidence above. No new deviation row written.

## Verdict: NO REFUTATION FOUND

All 5 AC verified. All 6 DoD verified. The prior CONCERNS defect is verified-eliminated (fix commit `91c6206` confirmed on master, all selfchecks green, DoD-3 re-verified). Mechanical gate passes. Escrow closed.
