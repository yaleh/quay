---
id: exp5-M-LIVE-A-native-testcov
title: "LIVE-batch A (DIR-044-LIVE proof): add a focused offline unit test for
  one currently-undertested PURE function in quay-native — real coverage gain,
  touches ONLY packages/quay-native/test/**, no src/shared-state change."
status: ready
labels:
  - milestone-candidate
parent: DIR-044-LIVE
children: []
extra:
  schema: v1
---
## Touches
- packages/quay-native/test/**

## Proposal
One half of the real ≥2-wide concurrent batch that proves [[DIR-044-LIVE]] / the DIR-044 mechanism runs live. Add a genuinely-useful, OFFLINE unit test (`node --test`) for ONE currently-undertested PURE function exported by `packages/quay-native/src/**` (e.g. a parsing/validation/formatting helper with no network, no disk-mutation, no GitHub). The test lands as a NEW file under `packages/quay-native/test/` and must PASS. Touch ONLY `packages/quay-native/test/**` — do NOT modify any `src`, and do NOT touch shared exp5 state (`dashboard.md`/`backlog.md`/`v-meta-ledger.md`/`milestone_counter`/`gate-events`).

## Plan
N/A — a single small test-coverage add; the gate is the new test passing under `node --test`.

## Acceptance Criteria
- [ ] A new `packages/quay-native/test/*.test.mjs` file adds ≥1 real assertion for a pure quay-native function; `node --test <file>` exits 0 offline.
- [ ] Only files under `packages/quay-native/test/**` were modified (no src, no shared state) — verifiable by `git diff --name-only`.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts.
- [ ] The new test runs green offline (real object, not a stub); scoped to `packages/quay-native/test/**`.
