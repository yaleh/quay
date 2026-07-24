---
id: exp5-M-OUTERLOOP-ROUTINE-WIRING
title: "Wire exp5 OUTER-LOOP to fire the DIR-051 routine track (HUMAN-STEERED, halt +
  golden-replay): teach OUTER-LOOP's checkpoint step to consume .quay/loop.yml
  routines: (routine-scheduler → dispatch probe → routine-file-gate), so
  self-validation (DIR-052) + architecture-analysis (DIR-053) + meta-cc mining
  (DIR-055) fire as STANDING routines on quay's own board — not just as ad-hoc
  explore milestones. The single shared wiring that makes all three routines real."
status: todo
labels:
  - milestone-candidate
  - human-steered
parent: null
children: []
extra:
  schema: v1
---
## Proposal
The DIR-051 routine mechanism is proven (real fire on archguard), and its riders' CAPABILITY is already
delivered on quay's board via the explore-milestone track — [[DIR-052]] self-validation produced
`PROBE-SV-M92-001` (a real quay defect, fixed M94); [[DIR-053]] architecture-analysis produced
`ARCH-M93-001..004` (god-packages/functions + an ABI violation, being fixed M95). But exp5's bespoke
OUTER-LOOP does NOT consume `.quay/loop.yml` `routines:` — so those runs happened as one-off SELECTed
milestones, NOT as a STANDING routine track firing on a cadence independent of SELECT.

This is the SINGLE shared wiring that makes all three routines literal standing routines on quay: teach
OUTER-LOOP's checkpoint step to run `routine-scheduler.mjs` against the workspace's `routines:` config,
dispatch each DUE routine's probe (DIR-048 dispatched infra), and file findings behind
`routine-file-gate.mjs` (quality/dedup/rate, FILE-only). Once wired, self-validation + architecture-analysis
+ meta-cc mining all fire from the same generic mechanism — one wiring, N routines (the DIR-051 intent).

**Why one task, not three:** the OUTER-LOOP routine-consumption step is generic — it fires whatever is in
`routines:`. Wiring it once lights DIR-052/053/055 together. Splitting into per-routine wiring tasks would
duplicate the same OUTER-LOOP edit (drift; ADR-004). The per-routine PROBE definitions already exist
(archguard config + `plugin/probes/`); only the OUTER-LOOP consumption is missing.

**Why HUMAN-STEERED (halt + golden-replay):** this edits `OUTER-LOOP.md` — the load-bearing
driver-self-rewrite file (ADR-015 / DIR-027 fence). It must be authored off-loop under `.halt`, behavior-
preserving, never a mid-loop autonomous self-rewrite. Firing quay's routines via the portable skill instead
is NOT an option — two loops on quay's board race (the coexist hazard); the wiring must live in OUTER-LOOP.

**Depends on** [[exp5-DEFECT-ROUTINE-GATE-SELF-REJECT]]: until the candidate-in-board self-reject bug is
fixed, routines can only file via a manual `/tmp/` staging workaround — wire this AFTER that lands so routines
file unattended.

**Out of scope:** the routine mechanism (DIR-051, done); the probe definitions (exist); the gate self-reject
fix (its own defect task); the portable skill (archguard already fires routines through it).

## Plan
N/A — a human-steered, golden-replay milestone editing OUTER-LOOP.md. Proposal-to-plan settles the exact
checkpoint-step edit (invoke `routine-scheduler.mjs` on `routines:` → dispatch DUE probes → file behind
`routine-file-gate.mjs`), single-sourcing the DIR-051 scripts (no re-implementation), and a golden-replay
proving behavior-preservation (a checkpoint with no due routines is byte-identical to today's ABSORB). TDD
per ADR-001; fresh-context adversarial audit per DIR-044/048.

## Acceptance Criteria
- [ ] OUTER-LOOP's checkpoint step runs `routine-scheduler.mjs` against the workspace `routines:` config and, for each DUE routine, dispatches its probe + files findings behind `routine-file-gate.mjs` — single-sourcing the DIR-051 scripts (grep: no re-implementation).
- [ ] A real standing-routine fire on quay's own board files ≥1 genuine evidence-backed task through the gate, unattended (no manual `/tmp/` workaround — depends on the gate self-reject fix); FILE-only held.
- [ ] Behavior-preserving: a checkpoint with NO due routine is byte-identical to today's ABSORB (golden-replay); absent-`routines` unchanged.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] OUTER-LOOP fires the routine track on a real checkpoint, filing a real task on quay's board unattended — pasted (DIR-026 real object); self-validation (DIR-052) + architecture-analysis (DIR-053) both fire from this one wiring.
- [ ] Authored human-steered + golden-replay (halt; ADR-015/DIR-027); DIR-051 scripts single-sourced (ADR-004); it0 DoD meta-enforcer passes; fresh-context adversarial audit confirms no behavior drift on a no-routine checkpoint.
- [ ] Per DIR-026 SPLIT-OR-COMMIT: the OUTER-LOOP edit and the real standing-fire proof each land done-or-`needs-human`.

## Execution record (human-steered, 2026-07-24)

OUTER-LOOP step 5 (CHECKPOINT) now carries the ROUTINE TRACK wiring (§5a):
1. Reads `routines:` from `.quay/loop.yml` (default `[]` = no-op, today's behavior preserved)
2. Evaluates triggers via `routine-scheduler.ts --event checkpoint`
3. For each DUE probe: `readProbeSpec` → instrument check → dispatch background agent → `routine-file-gate`
4. FILE-ONLY invariant mechanically backstopped (`git status --porcelain` post-fire)
5. Legacy `dispatch:` back-compat; opt-in + additive

All three scripts ship with the plugin (`${CLAUDE_PLUGIN_ROOT}/scripts/`):
routine-scheduler.ts, read-probe-spec.ts, routine-file-gate.ts — all EXISTS.
Three probe specs: plugin/probes/{self-validation,architecture-analysis,history-mining}.md.

Golden-replay: absent `routines:` = byte-identical to old behavior (scheduler exits 3 = none due → CONTINUE).
Selfchecks: dod-fixture 17/17, split-or-commit 383/383 PASS.
This is the single shared wiring that makes DIR-052/053/055 literal standing routines on quay's own board.

Status: done.
