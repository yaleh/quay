# M167 — Fix concurrent fan-in safety

**Task:** DIR-107 · **Counter:** 167 · **Chart:** 2
**Class:** development · **Value type:** capability-growth
**Deliverable:** yes · **Charter tokens:** ~1.2 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0. Fixes the DIR-075 concurrent execution path: removes the Land-phase merge race (N workflows merging to master concurrently), makes anti-drift a real pre-merge gate, and adds audit-independence gating to concurrent fan-in. Without these fixes, the concurrent path is UNSAFE and cannot be enabled.

## Scope
Fix 4 gaps in concurrent execution path per DIR-107 audit findings:
1. Remove merge-to-master from `execute-milestone.js` IS_CONCURRENT Land phase — commit in worktree branch instead, return `buildBranch`
2. Reorder `OUTER-LOOP.md` concurrent_execute: anti-drift runs BEFORE fan-in merge (pre-merge gate)
3. Add audit-independence check per survivor to concurrent fan-in
4. Document `|batch| = 0` dispatch branch in OUTER-LOOP.md

## Touches
- plugin/workflows/execute-milestone.js
- experiments/quay-perpetual-stream/OUTER-LOOP.md

## Done-when
1. IS_CONCURRENT Land phase no longer merges to master; commits in own branch, returns buildBranch
2. Serial path (mode absent/"serial") merge + counter++ behavior UNCHANGED
3. OUTER-LOOP.md concurrent_execute: anti-drift step d runs BEFORE fan-in merge step f
4. Step f is sole merge owner, consuming buildBranch, pruning after merge
5. Concurrent fan-in includes audit-independence check per survivor; failing → needs-human, excluded from fan-in
6. OUTER-LOOP.md dispatch documents |batch|=0 branch
7. All it0 selfchecks + gate hashes stay green
8. No serial-path regression

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ d6738ba27c29cb53940f3a14a5ffc185f14d19ef
