---
id: DIR-064-A
title: "DIR-064 child A [halt-free]: build S1/S2/S3 chart-2 cov-calculator
  scripts (Distribution-reliability / Delivery-completeness /
  External-validation-reach) + fixtures + ≥80% test (no driver edit —
  loop-autonomous)"
status: done
labels:
  - milestone-candidate
  - crystallization
parent: DIR-064
children: []
extra:
  schema: v1
---
## Proposal
Build the S1/S2/S3 chart-2 cov-calculator scripts (halt-free) — each computes its cov from an OBJECTIVE, capped source (S1: CI runtime-smoke pass/total; S2: release-manifest + version-consistency-check + foreign-install-e2e exit codes; S3: registry-bounded GateEvent count / target). Fixture-first + ≥80% sibling tests. NOT `human-steered` (edits no driver file — the loop can do it autonomously). See [[DIR-064]].

## Plan
N/A — resolved via this focused milestone; shape fixed by [[DIR-064]] + `drivable-workspaces.yml`.

## Acceptance Criteria
- [x] Three cov-calculators built + run + produce cov∈[0,1] from objective sources — S1=0.20 (1/5 artifacts, CI run 29981401108), S2=0.00 (0/3, 5-way version drift), S3=0.10 (1/10 registry workspaces, archguard reached). Independently re-run 2026-07-23, verdicts pasted in commit e70a101.
- [x] Each is a load-bearing script with a sibling `*.test.mjs` ≥80% coverage — S1 20/20 @97.4%, S2 21/21 @97.9%, S3 18/18 @94.9%; `loadbearing-test-gate.sh` PASS.
- [x] Evidence sources checked in (`chart2-s1-artifacts.json`, `chart2-s2-delivery.json`); version-consistency + S3 registry read live.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget, impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene, worktree-branch-hygiene, audit-independence).
- [x] Both/all scripts land as real load-bearing scripts with passing sibling tests (≥80%), verified by real `node --test` runs; `loadbearing-test-gate.sh` PASSes.
- [x] The calculators produce real cov from real sources (not fixtures) — verified independently, committed e70a101.
- [x] Touches NO driver file — `git show --stat e70a101` is entirely under `experiments/quay-perpetual-stream/{scripts,test}/` + the two evidence json; no OUTER-LOOP.md/inherited-core.md.

## Execution record
Milestone: human-steered chart-2 build (this session, 2026-07-23). Merge: e70a101. Realized: the 3 objective cov-calculators (S1/S2/S3) + evidence sources + ≥80% tests, all verified independently (not agent self-report). cov readings S1=0.20 / S2=0.00 / S3=0.10 feed [[DIR-064-B]]'s VT-model wiring (chart-2 opening = 8.50/85, global VT 119.15). Sibling of [[DIR-064-B]] under [[DIR-064]]. Status → done.