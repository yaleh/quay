---
id: DIR-063-A
title: "DIR-063 child A [halt-free]: chart-saturation-check detector +
  milestones-since-last-transition counter + anti-gaming guard scripts +
  fixtures + ≥80% test (no driver edit — loop-autonomous)"
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: DIR-063
children: []
extra:
  schema: v1
---
## Proposal
Build the MECHANISM for [[DIR-063]] without touching the driver — so the loop can do it autonomously
(this child is deliberately NOT `human-steered`: it edits no driver file, escalates nothing, drives no
workspace). Three standalone artifacts under `experiments/quay-perpetual-stream/scripts/`:
1. `chart-saturation-check.*` — reads three already-computed numbers (current chart headroom, the
   DIR-038 rolling slope, a new `milestones-since-last-transition` counter) and emits `TRANSITION-DUE`
   under hysteresis: `(slope ≈ 0 for ≥K consecutive checkpoints) AND (headroom < ε) AND (counter >
   the historical growth-phase length ~10)`.
2. The `milestones-since-last-transition` counter itself — a small derivation over `dashboard.md`'s
   chart-transition history, exposed as a checkpoint early-warning line (mirrors how DIR-038 exposes
   the rolling slope).
3. An anti-gaming guard function: given a drafted candidate value surface, reject it unless its `cov`
   source is machine-verifiable, capped, and un-inflatable (CI exit-code / GateEvent / registry-bounded
   — reuse the `drivable-workspaces.yml` guard pattern and the DIR-038-C discipline), AND reject unless
   the OLD chart's residual headroom has an explicit adjudication recorded (pursue / abandon / fold into
   new chart) — never silently skipped (DIR-063 Finding #5).

Wiring these into OUTER-LOOP's self-halt step, and the subagent-drafting escalation itself, are the
SEPARATE `human-steered` child [[DIR-063-B]] — explicitly out of THIS child's scope.

## Plan
N/A — resolved via a focused single milestone; shape well-defined by [[DIR-063]]'s own Requested-action
items 1/2/4 (the halt-free half). Three standalone scripts + fixtures + sibling tests; no driver edit.

## Acceptance Criteria
- [ ] `chart-saturation-check` returns NOT-DUE for a fixture with non-zero slope / headroom above ε,
  and `TRANSITION-DUE` for a fixture matching the real cp-120 state (slope 0, headroom small, counter
  108 >> 10) — both fixtures run, both verdicts pasted.
- [ ] The `milestones-since-last-transition` counter computes 108 against the real dashboard history
  (chart-1 opened m3, no transition since) — pasted, not asserted.
- [ ] The anti-gaming guard REJECTs a candidate surface with a non-machine-verifiable/uncapped cov
  source (RED fixture) and REJECTs a candidate lacking a residual-headroom adjudication, and PASSes one
  with a registry/CI-bounded cov AND an explicit adjudication (GREEN fixture) — both pasted.
- [ ] All three scripts are load-bearing with sibling `*.test.mjs` at ≥80% coverage (`node --test` exit
  0; figures pasted); `loadbearing-test-gate.sh` PASSes.
- [ ] `node experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts .` + the standard
  non-flaky suite stay green.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence). Per DIR-026 Reading A: the scripts merely existing is
necessary-not-sufficient. Done ONLY when:
- [ ] All three scripts land as real load-bearing scripts with passing sibling tests (≥80%), verified
  by real `node --test` runs (pasted).
- [ ] This child touches NO driver file — verifiable by `git show --stat` on its landing commit (no
  `OUTER-LOOP.md`/`inherited-core.md`/inner-iteration-prompt in the diff); if it does, it is misscoped
  and belongs in [[DIR-063-B]].

## Not selected (M121)

Not selected — `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH` selected instead: higher priority (DIR-004
URGENT, explicitly named by DIR-064-B as the next chart-2 S1 Δv mover), and cleanly investigation-
resolved this pass. Good next halt-free exploit pick — no blocking issue, just lower priority.

## Not selected (M122)

Not selected — `exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY` selected instead: direct continuation of
M121's own chart-2 S1 work, higher immediate value this pass. Still a good next halt-free exploit pick.

## Not selected (M123)

Not selected — M123 is a mandatory explore pick, not a slot this exploit candidate competed for. Good
next exploit pick once M123 clears.

## Not selected (M124)

Not selected — `exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH` selected instead: smaller, cleanly
bounded, had already been deferred 3 times. Good next halt-free exploit pick.

## Not selected (M125)

Not selected — `DIR-062-A` selected instead: same halt-free class, chosen for direct chart-2 S3
relevance this pass. Good next halt-free exploit pick.

## Not selected (M126)

Not selected — `exp5-M-PRODUCTIZED-DELIVERY-A` selected instead. Both this task and PRODUCTIZED-
DELIVERY-A made the Round-1 shortlist under the DIR-066 governor's first real exercise (streak=2,
floor=0.333, dSeats=1/nSeats=3, S=2: {PRODUCTIZED-DELIVERY-A, DIR-063-A}); Round 2 picked
PRODUCTIZED-DELIVERY-A as the direct chart-2 S2 mover (weight 30, cov=0.00) and DIR-004-urgent-adjacent
pick. This candidate is the N-seat occupant this pass and a strong next exploit pick.