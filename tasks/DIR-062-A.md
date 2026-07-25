---
id: DIR-062-A
title: "DIR-062 child A [halt-free]: build the human-steered classifier +
  drivable-workspace fail-closed gate + fixtures + ≥80% test (no driver edit —
  loop-autonomous)"
status: done
labels:
  - milestone-candidate
  - crystallization
  - milestone:M-125
parent: DIR-062
children: []
extra:
  dirStatus: resolved
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-062-A
    experiments/quay-perpetual-stream/charters/M125-dir062-a-drivable-workspace-gate.md
    /tmp/m125-absorb-entry.md
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
- [x] `drivable-workspace-check` FAILs closed (non-zero) for a fixture task targeting a path NOT under `authorized_root` (e.g. `/tmp/x`), and PASSes (0) for one targeting `/home/yale/work/archguard` — both fixtures run, both verdicts pasted. — `node .../drivable-workspace-check.ts /tmp/x` → `FAIL: 1/1 workspace path(s) NOT covered ... /tmp/x`, exit 1. `node .../drivable-workspace-check.ts /home/yale/work/archguard` → `PASS: all 1 workspace path(s) covered ...`, exit 0. Also live-verified end-to-end via `quay gate QC-T1 --gate drivable-workspace` with both targets (PASS / FAIL — real GateEvents).
- [x] `human-steered-classify` returns `humanSteered:true` for a fixture that edits `OUTER-LOOP.md`, `true` for a mission-redirection-flagged fixture, `true` for one driving an unlisted workspace, and `false` for one driving only `/home/yale/work/*` with no driver edit — pasted. — all 4 cases verified via both the library `classify()` function and the CLI.
- [x] Both scripts have a sibling `*.test.mjs`; `node --test <the two tests>` exits 0; each ≥80% line coverage (figures pasted). — 49/49 pass (26+23). Coverage: `drivable-workspace-check.ts` 97.86% lines; `human-steered-classify.ts` 94.55% lines. `loadbearing-test-gate.sh` PASS (31 total, 8 pass, 23 N/A, 0 fail).
- [x] The `drivable-workspace` gate is registered in BOTH `.quay/gates.yml` and `.quay/config.yml` (grep → present in both); `quay gate --list` includes it. — confirmed.
- [x] `node experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts .` + the standard non-flaky suite stay green. — split-or-commit: PASS, 368 tasks, no violations. Full experiments suite: 525/525 pass.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget, impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene, worktree-branch-hygiene, audit-independence). Per DIR-026 Reading A: the scripts merely existing is necessary-not-sufficient. Done ONLY when:
- [x] Both scripts land as real load-bearing scripts with passing sibling tests (≥80%), verified by real `node --test` runs (pasted), and `loadbearing-test-gate.sh` PASSes (no load-bearing script without a test).
- [x] The `drivable-workspace` gate produces a real GateEvent (PASS on a listed target, FAIL on an unlisted one) via `quay gate` — pasted.
- [x] it0 DoD meta-enforcer passes all clauses. — CONFIRMED via 2 independent audit passes: `it0-dod-check.sh` → all 12 clauses PASS/N/A, exit 0; `quay gate DIR-062-A` → PASS, exit 0, two independent real GateEvents (`2026-07-23T11:38:09.598Z` orchestrator + a corroborating audit re-run).
- [x] This child touches NO driver file — verifiable by `git show --stat` on its landing commit. — `git show --stat ecc7344` confirmed clean.

## Not selected (M121)

Not selected — `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH` selected instead: higher priority (DIR-004
URGENT, explicitly named by DIR-064-B as the next chart-2 S1 Δv mover), and this milestone's own
in-pass investigation resolved its sizing concern cleanly. This candidate remains a good next
halt-free exploit pick — no blocking issue, just lower priority this pass.

## Not selected (M122)

Not selected — `exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY` selected instead: direct continuation of
M121's own chart-2 S1 work (completes the 0.20→0.80 flip DIR-064-B originally predicted), higher
immediate value than this candidate. Still a good next halt-free exploit pick.

## Not selected (M123)

Not selected — M123 is a mandatory explore pick (M119-M122 were 4 consecutive exploits), not a slot
this exploit candidate competed for. Good next exploit pick once M123 clears.

## Not selected (M124)

Not selected — `exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH` selected instead: smaller, cleanly
bounded (a one-function fix with an established golden-diff verify pattern), and had already been
deferred 3 times. Good next halt-free exploit pick.

## Selected (M125)

Selected — direct exploit pick. Halt-free, chart-2 S3 relevant per DIR-064's own mapping
("DIR-062-A/B/C → S3 objective guard + S4"). See
`experiments/quay-perpetual-stream/charters/M125-dir062-a-drivable-workspace-gate.md`.

## Execution record (M125 ABSORB, 2026-07-23)

**Milestone:** M125 · **Iterations:** 1 (single-pass development-class mechanism build) ·
**Realized Δv:** 0 (halt-free mechanism build, chart-2 S3 relevant but not itself a cov-scoring
event — the gate/classifier exist but are not yet wired into a scored surface). **Merge commit:**
`ecc7344`. **Adversarial-audit verdict:** NO REFUTATION FOUND (see
`milestones/M125/audits/iteration-0-adversarial-audit.md`) — the audit actively mutation-tested both
new scripts (reverted the path-matching guard, flipped a boolean operator) and confirmed the real
test suite genuinely catches both regressions, the opposite of M124's tautology finding. One
non-blocking cosmetic correction (test-count breakdown). **DoD meta-enforcer:** PASS (two independent
real GateEvents, confirmed across 2 audit passes). One-line outcome: DIR-062's halt-free mechanism
(fail-closed workspace-drivability gate + pure human-steered classifier) lands with genuine,
mutation-tested regression coverage — DIR-062-B (human-steered driver wiring) remains open.

**Note (checkpoint-triggered, non-blocking to this task's own completion):** this milestone's ABSORB
coincides with the scheduled cp-125 checkpoint (`milestone_counter % 5 == 0`), which found a real
governance:product ratio breach (431:1 vs the 5:1 threshold) over the window since cp-120 — see
`checkpoints/cp-125.md`. This does NOT affect DIR-062-A's own completion (independently audited,
gated, done) but does affect the OUTER loop's own continuation decision at this boundary.