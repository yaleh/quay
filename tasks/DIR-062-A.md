---
id: DIR-062-A
title: "DIR-062 child A [halt-free]: build the human-steered classifier +
  drivable-workspace fail-closed gate + fixtures + ≥80% test (no driver edit —
  loop-autonomous)"
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: DIR-062
children: []
extra:
  schema: v1
---
## Proposal
Build the MECHANISM for [[DIR-062]] without touching the driver — so the loop can do it autonomously
(this child is deliberately NOT `human-steered`: it edits no driver file, redirects nothing, drives no
workspace). Two standalone artifacts under `experiments/quay-perpetual-stream/scripts/`:
1. `drivable-workspace-check.*` — a fail-closed gate: given a task's declared drive-target workspace
   path(s), PASS iff every target is covered by `drivable-workspaces.yml` (`authorized_root` or an
   explicit `workspaces[]` entry), FAIL closed otherwise (absent/unknown/outside-root → FAIL, never a
   silent pass). Wrappable by `quay gate --gate drivable-workspace` and registered as workspace data in
   `.quay/gates.yml` + `.quay/config.yml` (data-driven, NOT a driver edit).
2. `human-steered-classify.*` — a pure function computing a task's `human-steered` verdict from the 3
   DIR-062 clauses: (1) edits a driver file (OUTER-LOOP.md/inherited-core.md/inner-iteration prompts);
   (2) mission-redirection (a declared flag/marker on the task, since this is a judgment input, not a
   file fact); (3) drives a workspace not covered by the registry (reuses check #1). Returns
   `{humanSteered: bool, clauses: [...]}`.
Both are load-bearing → each ships a sibling `*.test.mjs` at ≥80% coverage (ADR-001 clause 2),
fixture-first (RED + GREEN). SELECT-wiring + the inherited-core definition edit are the SEPARATE
`human-steered` child [[DIR-062-B]] — explicitly out of THIS child's scope.

## Plan
N/A — resolved via a focused single milestone; shape well-defined by [[DIR-062]] + `drivable-workspaces.yml`, no staged design doc. (Two standalone scripts + fixtures + sibling tests + gate registration in `.quay/gates.yml`/`.quay/config.yml`; no driver edit.)

## Acceptance Criteria
- [ ] `drivable-workspace-check` FAILs closed (non-zero) for a fixture task targeting a path NOT under `authorized_root` (e.g. `/tmp/x`), and PASSes (0) for one targeting `/home/yale/work/archguard` — both fixtures run, both verdicts pasted.
- [ ] `human-steered-classify` returns `humanSteered:true` for a fixture that edits `OUTER-LOOP.md`, `true` for a mission-redirection-flagged fixture, `true` for one driving an unlisted workspace, and `false` for one driving only `/home/yale/work/*` with no driver edit — pasted.
- [ ] Both scripts have a sibling `*.test.mjs`; `node --test <the two tests>` exits 0; each ≥80% line coverage (figures pasted).
- [ ] The `drivable-workspace` gate is registered in BOTH `.quay/gates.yml` and `.quay/config.yml` (grep → present in both); `quay gate --list` includes it.
- [ ] `node experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts .` + the standard non-flaky suite stay green.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget, impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene, worktree-branch-hygiene, audit-independence). Per DIR-026 Reading A: the scripts merely existing is necessary-not-sufficient. Done ONLY when:
- [ ] Both scripts land as real load-bearing scripts with passing sibling tests (≥80%), verified by real `node --test` runs (pasted), and `loadbearing-test-gate.sh` PASSes (no load-bearing script without a test).
- [ ] The `drivable-workspace` gate produces a real GateEvent (PASS on a listed target, FAIL on an unlisted one) via `quay gate` — pasted.
- [ ] This child touches NO driver file — verifiable by `git show --stat` on its landing commit (no `OUTER-LOOP.md`/`inherited-core.md`/inner-iteration-prompt in the diff); if it does, it is misscoped and belongs in [[DIR-062-B]].

## Not selected (M121)

Not selected — `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH` selected instead: higher priority (DIR-004
URGENT, explicitly named by DIR-064-B as the next chart-2 S1 Δv mover), and this milestone's own
in-pass investigation resolved its sizing concern cleanly. This candidate remains a good next
halt-free exploit pick — no blocking issue, just lower priority this pass.