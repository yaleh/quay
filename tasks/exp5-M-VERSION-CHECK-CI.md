---
id: exp5-M-VERSION-CHECK-CI
title: "Wire version-consistency-check into CI: new ci.yml job that fails build
  on version drift"
status: done
labels:
  - milestone-candidate
  - capability-growth
  - milestone:M-132
parent: null
children: []
extra:
  schema: v1
---
## Proposal

M126 delivered `scripts/version-consistency-check.ts` — a fail-closed drift gate over 8 version-bearing
artifacts. But it's not wired into CI, so version drift can recur silently (it already happened once:
5-way drift across 8 files). Wire the check into `.github/workflows/ci.yml` as a new job that runs on
every push, failing the build on version drift.

## Plan

N/A — focused milestone. Add a CI job that runs `node --experimental-strip-types scripts/version-consistency-check.ts`.
Also verify the check fails correctly (RED: if versions drift, CI fails) and passes on the current tree.

## Acceptance Criteria
- [ ] New CI job `version-consistency` in `.github/workflows/ci.yml` runs on every push/PR
- [ ] Job runs `node --experimental-strip-types scripts/version-consistency-check.ts` and fails the build on non-zero exit
- [ ] RED: intentionally drift one version → CI job fails (demonstrated by the check script, not a real CI run)
- [ ] GREEN: current unified tree → CI job passes (check script exit 0)
- [ ] Standard non-flaky suite stays green

## Definition of Done
Standard inherited-core DoD clauses apply. Development-class (touches .github/workflows/ci.yml — product pipeline).
- [ ] CI job added and verified
- [ ] it0 DoD meta-enforcer passes