---
id: gap-recursive-guard-only-covers-multi-mechanism
title: "split-recursive-guard only fires for split-multi-mechanism — a depth-2+
  leaf triggering any other split code still auto-splits"
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

`checkSplitRecommendation`'s `wbsLevel >= 2` guard (landed 2026-08-02) fires ONLY inside the
`split-multi-mechanism` branch. A depth-2+ leaf that triggers `split-subsystem-blocking-cluster`
or `split-touch-set-too-large` still returns those codes, and the orchestrator auto-splits.

**Evidence (telemetry, 232 dispatches):** splits at depth 2 occurred for 8 distinct tasks
(DIR-124-F4/F3/B2/A4/A3/A1, DIR-119-D5/D3) and at depth 3 for 2 (DIR-124-A1b, DIR-124-F3b).
The guard caught 2 of these; the rest predate it or took a non-multi-mechanism path.

**Rationale:** a task that has already survived two rounds of decomposition and STILL triggers any
split signal has an upstream structural defect. The trigger code tells you *which* symptom fired;
it does not change the conclusion that further auto-splitting compounds the problem.

## Chosen mechanism

Hoist the `wbsLevel >= 2` check ABOVE the three trigger branches in `checkSplitRecommendation`.
When depth >= 2 and ANY trigger would fire, return `split-recursive-guard` with the original
trigger's reason text preserved as context.

Ordering matters: the guard must evaluate the triggers first (to know one WOULD fire and to
capture its reason), then override the code. A bare `if (wbsLevel >= 2) return guard` at the top
would fire on every deep task even when no split is warranted.

## Acceptance Criteria

- [ ] AC1: depth >= 2 + subsystem-blocking-cluster → `split-recursive-guard` (not cluster)
- [ ] AC2: depth >= 2 + touch-set-too-large → `split-recursive-guard`
- [ ] AC3: depth >= 2 + multi-mechanism → `split-recursive-guard` (existing behavior preserved)
- [ ] AC4: depth >= 2 + NO trigger fires → `recommend: false` (guard does not fire spuriously)
- [ ] AC5: depth 0/1 + any trigger → original code unchanged (no regression)
- [ ] AC6: guard result carries `repairable: false` and the originating trigger's reason text
- [ ] AC7: both mirrors byte-identical; `_splitCheck()` in prepare-milestone.js matches

## Definition of Done

- [ ] `checkSplitRecommendation` in both `proposal-convergence.ts` mirrors implements the hoisted guard
- [ ] `_splitCheck()` in both `prepare-milestone.js` mirrors matches
- [ ] Tests cover AC1-AC5; existing `checkSplitRecommendation` tests still pass
- [ ] `scripts/test.sh` green

## Touches

- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- plugin/test/proposal-convergence.test.mjs
- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
