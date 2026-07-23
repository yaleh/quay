# M127 iteration-0 report — chart-saturation-check mechanism

**Milestone:** M127 · **Task:** DIR-063-A
**Iteration:** 0 · **Charter:** charters/M127-dir063a-chart-saturation-check.md

## Summary

Implemented three standalone halt-free scripts for the DIR-063 chart-transition meta-mechanism, each with sibling test at ≥80% coverage. No driver files touched.

## Scope delivered

1. `experiments/quay-perpetual-stream/scripts/chart-saturation-check.ts` — reads slope/headroom/counter, emits TRANSITION-DUE under hysteresis: (slope ≤ ε, headroom < ε, counter > 10). 10/10 tests pass, 96.97% line coverage.

2. `experiments/quay-perpetual-stream/scripts/milestones-since-transition.ts` — derives counter from dashboard.md chart-transition history. Real output: milestones-since-transition=5 (M121→M126). 7/7 tests pass, 100% line coverage.

3. `experiments/quay-perpetual-stream/scripts/anti-gaming-guard.ts` — validates candidate surfaces: machine-verifiable cov + capped + non-inflatable + explicit residual-headroom adjudication. 10/10 tests pass, 100% line coverage.

## Test evidence

All 27/27 tests pass across all 3 suites:
```
chart-saturation-check.test.ts: 10/10 PASS (96.97% line)
milestones-since-transition.test.ts: 7/7 PASS (100% line)
anti-gaming-guard.test.ts: 10/10 PASS (100% line)
```

## Real counter output

```
milestones-since-transition: 5
  current chart: 2
  last transition: M121
  current milestone: 126
  growth-phase-length threshold: 10
```

## TRANSITION-DUE demonstration (cp-120 fixture)

```
Verdict: TRANSITION-DUE (slope=0 ≤ 0.02, headroom=0.08 < 0.10, counter=117 > 10)
```

## NOT-DUE demonstration (current state)

```
Verdict: NOT-DUE (counter=5 ≤ 10 — too soon since last transition)
```

## Anti-gaming guard RED/GREEN

- GREEN: machine-verifiable cov + capped + non-inflatable + adjudication=fold → PASS
- RED: subjective cov + no adjudication → REJECT (exit 1)

## Files changed

All under `experiments/quay-perpetual-stream/scripts/`:
- `chart-saturation-check.ts` (new)
- `chart-saturation-check.test.ts` (new)
- `milestones-since-transition.ts` (new)
- `milestones-since-transition.test.ts` (new)
- `anti-gaming-guard.ts` (new)
- `anti-gaming-guard.test.ts` (new)

No driver files touched. No packages/ files changed.

## DoD self-check

- [x] All three scripts land as load-bearing with passing sibling tests (≥80%): confirmed
- [x] No driver file touched: confirmed (all changes under experiments/quay-perpetual-stream/scripts/)
- [ ] it0 DoD meta-enforcer — to verify at ABSORB
