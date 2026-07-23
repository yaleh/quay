# Charter M127-dir063a — chart-saturation-check mechanism (DIR-063 child A)

**Milestone id:** M127
**Task:** `tasks/DIR-063-A.md`
**Surface:** methodology-class / governance-integrity (discovery — grows reusable structural-analysis core)
**Charter authored:** 2026-07-23
**Base commit:** master HEAD at dispatch (`aee6166`, M126 ABSORB close-out)
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

DIR-063 identified a structural pathology: chart-1 stayed flat for 108 milestones (m12→m120) with no
transition mechanism. The human-gated transition model failed exactly once and catastrophically. DIR-063
split into two children: -A (halt-free mechanism: detector + counter + anti-gaming guard) and -B
(human-steered: wire into OUTER-LOOP self-halt). This child is -A — build the MECHANISM, edit no driver.

**M127 is the 4th exploit since M123 explore reset** (M124 clause8, M125 DIR-062-A, M126 PRODUCTIZED-A,
M127 DIR-063-A). M128 will be mandatory explore per ≥1/5 rule.

## SELECT — DIR-066 Round-1 deliverable governor

Incoming streak: **0** (M126 was `deliverable:yes`, reset). f=0, nSeats=round(4)=4, dSeats=0.
Autonomous-selectable N candidates: DIR-063-A (rank 1), exp5-M-CRYST-D2 (rank 2). Shortlist: both
(2 ≤ 4 N-seats). Round 2 picked DIR-063-A — aged (deferred 6 times since M121), clearly bounded,
structural improvement to the loop's self-awareness. exp5-M-CRYST-D2 gets a not-selected note.

## Scope

Three standalone scripts under `experiments/quay-perpetual-stream/scripts/`, each with sibling test:

1. **`chart-saturation-check.ts`** — reads chart headroom + rolling slope + counter; emits
   `TRANSITION-DUE` iff `(slope ≈ 0 for ≥K consecutive checkpoints) AND (headroom < ε) AND
   (counter > growth-phase-length ~10)`. ε and K are constants in the script.

2. **`milestones-since-transition.ts`** — derives the counter from dashboard.md's chart-transition
   history (chart-1 opened m3, no transition since → 124 milestones as of M127). Exposed as a
   checkpoint early-warning line.

3. **`anti-gaming-guard.ts`** — given a drafted candidate surface, PASSes iff: (a) cov source is
   machine-verifiable, capped, un-inflatable (CI exit-code / GateEvent / registry-bounded); AND
   (b) old chart's residual headroom has an explicit adjudication (pursue/abandon/fold).

**Not in scope:** wiring into OUTER-LOOP self-halt; subagent-drafting escalation. Both are DIR-063-B.

## Acceptance Criteria (from task)

- [ ] `chart-saturation-check` returns NOT-DUE for a fixture with non-zero slope / headroom above ε,
  and `TRANSITION-DUE` for a fixture matching the real cp-120 state.
- [ ] The `milestones-since-last-transition` counter computes the real number against dashboard history.
- [ ] Anti-gaming guard REJECTs uncapped/subjective/not-adjudicated surfaces, PASSes machine-verifiable
  ones with explicit adjudication.
- [ ] All three scripts load-bearing with sibling tests ≥80% coverage; `loadbearing-test-gate.sh` PASS.
- [ ] Standard non-flaky suite green.

## Definition of Done

Standard inherited-core DoD clauses apply. Per DIR-026 Reading A: scripts existing is
necessary-not-sufficient — done ONLY when all three land as real load-bearing scripts with passing
sibling tests (≥80%), verified by real `node --test` runs.
- [ ] No driver file touched (`git show --stat` confined to `experiments/quay-perpetual-stream/scripts/` + tests).
- [ ] it0 DoD meta-enforcer passes all clauses.

## Class routing

**Methodology-class** (deliverable is a methodology doc/script; discovery/governance-integrity typed).
No `quay-task-to-plan` pipeline required. Dispatch directly to `baime:iteration-executor`.

## it0 systematic-explore checks (pre-dispatch)

- **(a) ceiling/floor arithmetic:** N/A — task-canonical-sourced (DIR-028).
- **(b) gate-hash/transclusion:** see GATE-HASH-REF below.
- **(c) dogfooding evidence-gate:** applied per-iteration.
- **(d) domain-misfit audit-channel:** direct — the auditor can independently re-run all three scripts
  against cp-120 state from git history.
- **(e) plan-time line-budget gate:** this charter is well under the ~2000-line ceiling (three
  ~100-line scripts + tests, no phase/stage plan needed).

## GATE-HASH-REF

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93
