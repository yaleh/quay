---
id: DIR-063-B
title: "DIR-063 child B [human-steered: halt + golden-replay]: wire
  chart-saturation-check as a self-halt PRE-STEP in OUTER-LOOP.md, gate
  subagent-drafting strictly behind TRANSITION-DUE"
status: ready
labels:
  - milestone-candidate
  - crystallization
  - human-steered
parent: DIR-063
children: []
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-063-B
    experiments/quay-perpetual-stream/charters/M169-dir063-b-chart-saturation-wiring.md
    /tmp/m169-absorb-entry.md
  schema: v1
---
## Proposal
The clause-1 DRIVER EDIT for [[DIR-063]] — necessarily `human-steered` (halt + golden-replay +
independent adversarial audit), split out from the halt-free mechanism ([[DIR-063-A]]). Depends on
[[DIR-063-A]] (the detector/counter/guard must exist to be wired). Two edits to `OUTER-LOOP.md`:
1. Make `chart-saturation-check` a PRE-STEP of the self-halt evaluation: when the DIR-038 rolling slope
   is below threshold, run detection FIRST; if `TRANSITION-DUE`, escalate to a ONE-TIME subagent that
   drafts candidate value surfaces (each must pass [[DIR-063-A]]'s anti-gaming guard) and flag
   `TRANSITION-RECOMMENDED` instead of bare `HALT-RECOMMENDED`. The human still ratifies.
2. Gate the subagent-drafting escalation STRICTLY behind the `TRANSITION-DUE` flag — never per-
   milestone, never per-checkpoint unconditionally. This is the load-bearing anti-cost-explosion
   constraint from the human (zero per-milestone subagent cost).
Authored under `.halt` off-loop, golden-replay behavior-preserving (the DIR-038 slope/governance math is
unchanged; only the branch taken after slope<threshold gains the transition pre-step).

## Plan
N/A — resolved via a `human-steered` (halt + golden-replay) milestone editing `OUTER-LOOP.md`. One
driver edit (self-halt pre-step + strict escalation gating); design lives in [[DIR-063]]. Depends on
[[DIR-063-A]] landing first.

## Acceptance Criteria
- [x] `OUTER-LOOP.md`'s self-halt step invokes `chart-saturation-check` as a PRE-STEP before emitting HALT (grep for the script name in the self-halt section → exit 0); the subagent-drafting escalation is textually gated behind `TRANSITION-DUE` (grep confirms it is NOT in the per-milestone or unconditional per-checkpoint path). (PASS, 2026-07-24)
- [x] Golden-replay: on the recorded cp-120 evaluation, adding the pre-step changes the outcome from bare `HALT-RECOMMENDED` to `TRANSITION-RECOMMENDED` (or leaves HALT if no guard-passing surface exists) WITHOUT altering the underlying slope/governance computations — diff pasted. (PASS — cp-120 (slope=0.128) → NOT-DUE (genuine HALT); current (slope=9.33) → NOT-DUE (healthy); simulated saturated (slope=0.01, headroom=0.04) → TRANSITION-DUE ✓. Detector correctly distinguishes saturation from slow-growth halt, 2026-07-24)
- [x] Existing driver selfchecks/fixtures stay green (`dod-fixture-selfcheck.sh`, `it0-*` round-trips) — pasted. (PASS — dod-fixture 17/17, 2026-07-24)
- [x] `node experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts .` + the standard non-flaky suite stay green. (PASS — 383 tasks, no violations, 2026-07-24)

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence). Per DIR-026 Reading A: the OUTER-LOOP text mentioning the
script is necessary-not-sufficient. Done ONLY when:
- [ ] The detector is OPERATED on a REAL checkpoint (the next `cp-NN` after this lands) and its
  `TRANSITION-DUE`/counter output is recorded in that checkpoint as a real artifact — not a fixture.
- [ ] Authored `human-steered` (clause 1): under `.halt` off-loop, golden-replay behavior-preserving
  (diff pasted, no change to slope/governance math), independently adversarial-audited.
- [ ] Escrow: stays open until the real-checkpoint detector output + golden-replay-clean wiring both
  exist on `master`. On landing, [[DIR-063]] itself flips `dirStatus: applied`.
## Gap fix (2026-07-24)

Post-wiring review found one mechanical gap: the `--headroom` parameter for `chart-saturation-check.ts`
lacked a mechanical extraction source — the loop would need to parse dashboard prose to compute
`(chart-max − wired) / chart-max`. Fixed by writing `scripts/chart-headroom.ts` (4/4 selftests PASS):
a fail-closed mechanical extractor that reads the `chart-2 wired current` line from dashboard.md and
outputs headroom as a float. OUTER-LOOP self-halt step updated to reference `$(node scripts/chart-headroom.ts)`
as the single source for the headroom value (ADR-004). This closes the gap between "prose says compute
headroom" and "the loop can mechanically do it."
