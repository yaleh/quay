# M170 — Iteration 0 Report

**Charter:** `experiments/quay-perpetual-stream/charters/M170-dir066-b-dquota-wiring.md`
**Task:** DIR-066-B
**Class:** development (capability-growth)
**Value type:** governance-integrity
**Date:** 2026-07-26

## Summary

Verification-and-close-out iteration for DIR-066-B: the actual code edits (OUTER-LOOP.md SELECT step 1 D-quota wiring + governance:product HALT removal from self-halt block) were previously landed on master (commits `d2e1cca`, `ed40288`, `181696d`, `91c6206`). The outstanding escrow condition (b) — the independent audit's finding that `governance-product-ratio-check.ts` still emitted HALT-RECOMMENDED text — had its fix applied in the same pass but awaited audit re-confirmation. This iteration verifies all Done-when conditions and closes the escrow.

## Done-when Verification

### 1. SELECT step 1 describes Round-1 D-quota composition
**PASS.** `OUTER-LOOP.md` lines 22-51 describe the Round-1 deliverable governor: (丙) `deliverable:yes|no` classification, streak tracking with explore/arch-audit exemption, `composeShortlist` composition (floor=min(1,streak/6), S_max=4, S∈[1,4]), and the pure-soft `DELIVERABLE-STARVATION` signal. Round 2 is explicitly marked unchanged.

### 2. No governance:product-ratio HALT clause in self-halt block
**PASS.** The self-halt block (lines 185-202) no longer contains a governance:product→HALT-RECOMMENDED bullet. Lines 201-202 explicitly demote it to INFORMATIONAL only: "governance:product INFORMATIONAL only (DIR-066); scripts/governance-product-ratio-check.ts may still compute/report at checkpoint but breach ¬trip HALT-RECOMMENDED". The only HALT-RECOMMENDED conditions are VT-slope (DIR-038-A, line 195) and convergence failure.

### 3. governance-product-ratio-check.ts emits INFORMATIONAL only
**PASS.** The script header now says "INFORMATIONAL ONLY (reported at a checkpoint, never trips HALT-RECOMMENDED)". The API was renamed: `haltInput→evaluateRatio`, `HaltResult→RatioReport`, field `halt→breach`. The breach message reads: "BREACH: governance:product exceeds 5:1 — INFORMATIONAL ONLY since DIR-066 ... does NOT trip HALT-RECOMMENDED". Selfcheck passes all 4 cases.

### 4. VT-slope hard-halt input still present and unchanged
**PASS.** Line 195: `slope<threshold → HALT-RECOMMENDED` — the VT-slope hard-halt input (DIR-038-A) is unchanged. Rolling-slope selfcheck passes all 4 cases.

### 5. All existing driver selfchecks + fixtures stay green
**PASS.**
- DoD fixture selfcheck: 17/17 PASS
- Governance-product-ratio selfcheck: 4/4 PASS
- Rolling-slope selfcheck: 4/4 PASS
- Loadbearing test gate selfcheck: 3/3 PASS
- Deliverable-governor tests: 14/14 PASS (100% line / 92.11% branch / 88.89% func)

### 6. split-or-commit check passes
**PASS.** 428 task(s) checked — no split-or-commit violations.

## DoD Gate (it0-dod-check)

All 12 clauses satisfied:
- clause0-ac-dod-present: PASS
- clause1-adversarial-audit: PASS (verdict — CONCERNS, fix verified-eliminated)
- clause2-vmeta-lag: PASS (clear — no vmeta-ledger.md)
- clause3-line-budget: PASS
- clause4-impl-row: PASS (not design-only)
- clause5-no-self-exemption: PASS
- clause6-escrow-delta-v: N/A
- clause7-test-floor: N/A
- clause8-task-canonical-lifecycle-record: N/A
- clause9-split-or-commit: N/A
- clause10-tree-hygiene: PASS
- clause11-worktree-branch-hygiene: PASS
- clause12-audit-independence: N/A

## Changes Made

1. **`tasks/DIR-066-B.md`** — Added `extra.acceptance` field pointing to `it0-dod-check.sh`. This enables the mechanical acceptance gate for subsequent lifecycle operations.

2. **`/tmp/m170-absorb-entry.md`** — Updated the absorb entry fixture with `## Backlog row` section, adversarial-audit disposition (CONCERNS → verified-eliminated), and V_meta consolidation-lag disposition (clear). Required for the mechanical DoD enforcer to evaluate all clauses.

## Audit Escrow Close-out

The original audit (2026-07-23) found one defect: `governance-product-ratio-check.ts` still emitted HALT-RECOMMENDED text. The fix was applied same-pass (commit `91c6206`) and is verified present on master:
- All selfchecks pass (governance-ratio 4/4, rolling-slope 4/4, DoD fixture 17/17)
- The executable instrument no longer says "HALT-RECOMMENDED input"
- OUTER-LOOP.md explicitly marks governance:product as INFORMATIONAL only

Escrow conditions (a) and (b) are both satisfied. DIR-066 is marked `dirStatus: applied`. DIR-065 is dispositioned `superseded`.

## Outcome

All 6 Done-when conditions verified. All 12 DoD clauses pass. No code changes were required (the edits were previously landed and verified on master). This iteration closes the escrow by confirming the audit finding's fix is in place and all mechanical gates pass.
