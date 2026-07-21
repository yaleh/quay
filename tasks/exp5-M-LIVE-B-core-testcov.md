---
id: exp5-M-LIVE-B-core-testcov
title: "LIVE-batch B (DIR-044-LIVE proof): add a focused offline unit test for
  one currently-undertested PURE function in quay Core — real coverage gain,
  touches ONLY packages/quay/test/**, no src/shared-state change, NOT a
  live-github suite."
status: ready
labels:
  - milestone-candidate
parent: DIR-044-LIVE
children: []
extra:
  schema: v1
---
## Touches
- packages/quay/test/**

## Proposal
The other half of the real ≥2-wide concurrent batch proving [[DIR-044-LIVE]]. Add a genuinely-useful, OFFLINE unit test (`node --test`) for ONE currently-undertested PURE function exported by `packages/quay/src/**` (Core — e.g. a gate/lifecycle/view-model/parse helper with no network). The test lands as a NEW file under `packages/quay/test/` and must PASS offline. It MUST NOT be one of the known live-GitHub suites (`serve-github.test.mjs`, `provider-abi-conformance.test.mjs`) and must not require network. Touch ONLY `packages/quay/test/**` — do NOT modify any `src`, and do NOT touch shared exp5 state.

## Plan
N/A — a single small test-coverage add; the gate is the new test passing under `node --test`.

## Acceptance Criteria
- [ ] A new `packages/quay/test/*.test.mjs` file adds ≥1 real assertion for a pure Core function; `node --test <file>` exits 0 offline.
- [ ] Only files under `packages/quay/test/**` were modified (no src, no shared state) — verifiable by `git diff --name-only`.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts.
- [ ] The new test runs green offline (real object, not a stub); scoped to `packages/quay/test/**`.
