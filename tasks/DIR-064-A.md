---
id: DIR-064-A
title: "DIR-064 child A [halt-free]: build S1/S2/S3 chart-2 cov-calculator
  scripts (Distribution-reliability / Delivery-completeness /
  External-validation-reach) + fixtures + ≥80% test (no driver edit —
  loop-autonomous)"
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: DIR-064
children: []
extra:
  schema: v1
---
## Proposal
Build the MECHANISM for [[DIR-064]]'s chart-2 without touching the driver's VT model itself (that write
is the separate `human-steered` child [[DIR-064-B]]). Three standalone cov-calculator scripts under
`experiments/quay-perpetual-stream/scripts/`, each emitting `cov∈[0,1]` from an OBJECTIVE, capped
source (no subjective/inflatable input, mirroring the DIR-038-C discipline):
- **S1 Distribution reliability** — `(release artifacts passing runtime-smoke on the declared Node
  floor) / (total artifacts)`. Computed from a real CI run's job/step conclusions (e.g. the v0.3.8
  release run: npm-pack pass, SEA×3 fail → cov≈0.2).
- **S2 Delivery completeness** — `(manifest items published ∧ version-consistent ∧
  foreign-install-e2e-green) / (total)`. Computed from the release manifest + a version-consistency
  check + a foreign-install e2e exit code.
- **S3 External-validation reach** — `(drivable-workspaces-registry workspaces with an observed real
  ABI task-status GateEvent) / (target set)`. Computed from `drivable-workspaces.yml` + real
  `gate-events.jsonl` entries.
Each is fixture-first (RED + GREEN) with a sibling `*.test.mjs` at ≥80% coverage (ADR-001 clause 2).

## Plan
N/A — resolved via a focused single milestone; shape well-defined by [[DIR-064]]'s own S1/S2/S3
definitions (Proposal table) and Requested-action item 3. Three standalone scripts + fixtures + sibling
tests; no driver edit.

## Acceptance Criteria
- [ ] Each of S1/S2/S3 runs and emits a `cov∈[0,1]` from its objective source — pasted (e.g. S1
  computed from the real v0.3.8 CI run: npm-pack pass, SEA×3 fail → cov≈0.2).
- [ ] Each calculator is a load-bearing script with a sibling `*.test.mjs` ≥80% coverage (`node --test`
  exit 0; figures pasted); `loadbearing-test-gate.sh` PASSes.
- [ ] A concrete Δv demonstration: show that closing `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH` would move
  S1 from ~0.2 toward ~0.8 (i.e. the open backlog now scores on chart-2) — computed, pasted.
- [ ] `node experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts .` + the standard
  non-flaky suite stay green.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence). Per DIR-026 Reading A: the scripts merely existing is
necessary-not-sufficient. Done ONLY when:
- [ ] All three calculators land as real load-bearing scripts with passing sibling tests (≥80%),
  verified by real `node --test` runs (pasted).
- [ ] This child touches NO driver file — verifiable by `git show --stat` on its landing commit (no
  `inherited-core.md`/`OUTER-LOOP.md` in the diff); if it does, it is misscoped and belongs in
  [[DIR-064-B]].