# M185 — Tighten concurrent-batch eligibility to require value-type=capability-growth (DIR-116)

**Task:** DIR-116 · **Counter:** 185 · **Chart:** 2
**Class:** development · **Value type:** instrumentCorrection
**Deliverable:** no · **Charter tokens:** ~0.7 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0 (instrument-correction, VT-neutral). The concurrent-batch safety net that actually exists
today is three independent, narrower mechanisms stitched together (driver-file check, 4 hardcoded
`SHARED_STATE_PATHS`, `isLearning(type)` regex match) — none of them check the candidate's own
`value-type` field. A `governance-integrity`/`instrument-correction`-typed candidate that avoids
those specific paths and isn't tagged `type:learning` can currently enter a concurrent batch, even
though it's exactly the class of work DIR-057's original safety argument was written to exclude.
Real evidence: DIR-109 declared `instrumentCorrection` and was the surviving M173 batch candidate
(collapsed to 1-wide for an unrelated reason, not because value-type was checked).

## Scope
Per DIR-116's own Requested action:
1. `concurrent-batch-scheduler.ts`'s `assembleBatch`/`parseCandidate` gains a value-type check:
   non-`capability-growth` candidates are deferred, with a deferral reason distinguishable from the
   existing touches-overlap deferral reason.
2. Both mirrors (`plugin/scripts/concurrent-batch-scheduler.ts` +
   `experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.ts`) — if DIR-070's
   symlink work already unified them, only one needs editing; otherwise both.
3. No change to build-concurrent/fan-in-serial architecture itself, no change to DIR-106/107's
   landed fan-in/anti-drift/audit-independence mechanisms.
4. A synthetic/replay scenario proving the gap was real: a `governance-integrity`-typed candidate,
   touches-disjoint from existing candidates and the 4 hardcoded shared paths, judged "can batch"
   under the pre-change logic (RED) and correctly blocked after (GREEN) — both states shown.

**Out of scope:** anything else in DIR-057's original wider scope (already covered by DIR-106/107,
per DIR-057's own closure).

## Touches
- experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.ts
- plugin/scripts/concurrent-batch-scheduler.ts
- experiments/quay-perpetual-stream/test/concurrent-batch-scheduler.test.mjs (or sibling test path)

## Done-when
1. `assembleBatch`/`parseCandidate` defers non-capability-growth candidates, with a clearly
   distinguishable deferral reason.
2. RED/GREEN pair for the synthetic governance-integrity scenario, both states shown as real output.
3. A real capability-growth candidate (clean touches) is unaffected before and after — no
   false-positive exclusion of the main path.
4. Both mirror files stay in sync (or are already unified via symlink).
5. Existing `concurrent-batch-scheduler` sibling test suite passes; ≥2 new test cases cover the
   RED/GREEN scenarios above.

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
