# M187 — restart-readiness-check.sh/select-preflight.test.mjs: fix the halt-path documentation-vs-code mismatch (gap-halt-sentinel-path-mismatch)

**Task:** gap-halt-sentinel-path-mismatch · **Counter:** 187 · **Chart:** 2
**Class:** development · **Value type:** instrumentCorrection
**Deliverable:** no · **Charter tokens:** ~0.6 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0 (instrument-correction, VT-neutral). `CLAUDE.md` was found documenting the wrong `.halt`
sentinel location this session (already corrected in-place); `restart-readiness-check.sh` still
hardcodes the wrong (`experiments/quay-perpetual-stream/.halt`) path, disagreeing with the real,
consistently-implemented repo-root convention (`select-preflight.ts`'s `checkHalt()`,
`plugin/skills/loop-driver/SKILL.md`). This milestone finishes the remaining code-level fix and
adds a regression-guard test so this specific confusion can't recur silently.

## Scope
Per `tasks/gap-halt-sentinel-path-mismatch.md`'s Requested action (items 1 and 3; item 2 —
`CLAUDE.md` — already landed):
1. `restart-readiness-check.sh`'s `HALT="experiments/quay-perpetual-stream/.halt"` → repo-root
   `.halt`, matching `select-preflight.ts`'s real, live convention.
2. New selftest fixture (in `select-preflight.test.mjs` or wherever `checkHalt`'s existing fixtures
   live): a `.halt` file placed ONLY at the `experiments/quay-perpetual-stream/` path (not repo
   root) must NOT satisfy the check (`halt: false`) — an explicit regression guard against this
   exact confusion recurring, not just a silent fix.

**Out of scope**: wiring `restart-readiness-check.sh` into `OUTER-LOOP.md`'s actual resume path
(orphaned-script problem, tracked separately in `gap-orphaned-check-scripts-not-wired`); the
`checkHalt()` fail-open→fail-closed change (that's `DIR-120`'s scope, a different charter/milestone
running concurrently with this one — both touch `select-preflight.ts` in DIFFERENT, non-conflicting
regions: this milestone only touches `restart-readiness-check.sh` + adds a NEW test fixture, DIR-120
touches `checkHalt()`'s own catch-block body).

## Touches
- experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
- experiments/quay-perpetual-stream/test/select-preflight.test.mjs

## Done-when
1. `restart-readiness-check.sh` checks the same repo-root path `select-preflight.ts` does — real
   diff pasted.
2. New regression-guard fixture exists and demonstrably fails (RED) against the OLD code path logic
   if re-run there, and passes (GREEN) against the fix — both states documented, not just GREEN.
3. Existing test suite green — this is a strictly additive change (one script's hardcoded path, one
   new test case), no existing behavior removed.

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
