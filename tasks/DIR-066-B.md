---
id: DIR-066-B
title: "DIR-066 child B [human-steered: halt + golden-replay]: wire the Round-1
  D-quota into OUTER-LOOP step 1 (candidates-considered-this-pass) + REMOVE
  DIR-038-B's governance:product→HALT-RECOMMENDED clause from the self-halt block"
status: todo
labels:
  - milestone-candidate
  - human-steered
parent: DIR-066
children: []
extra:
  schema: v1
---
## Proposal

The driver-edit half of [[DIR-066]] — necessarily `human-steered` (halt + golden-replay + independent
adversarial audit), depends on [[DIR-066-A]] (the governor functions must exist to reference). Two edits to
`OUTER-LOOP.md`:
1. **SELECT step 1** — insert the Round-1 shortlist composition: over the autonomous-selectable candidates
   (`human-steered` already excluded), classify each `deliverable:yes|no` (丙), maintain the streak, and
   compose the "candidates considered this pass" set via [[DIR-066-A]]'s `composeShortlist` (S∈[1,4]). Round 2
   (the VT Δv̂ + value-typed ledger + governance/infra hard-floor ranker) is UNCHANGED — it picks the winner
   from the ≤4 shortlist. Record the per-candidate `deliverable` + streak + S in the SELECT rationale.
2. **Self-halt block (§, lines ~566–571)** — REMOVE the `governance:product ratio → HALT-RECOMMENDED`
   bullet (DIR-038-B). The ratio check may remain as an INFORMATIONAL report at the checkpoint but no longer
   trips a halt; the "degradation across tracks" halt condition no longer includes it. Add the pure-soft
   `DELIVERABLE-STARVATION` signal (visible, never halts) as the replacement surfacing.

**Note:** VT-slope (DIR-038-A) remains a hard-halt input — untouched by this directive (it is currently
healthy). Authored under `.halt` off-loop, golden-replay behavior-preserving on chart-1's frozen cells.
Coordinate with [[exp5-M-CRYST-D3]] if it rewrites OUTER-LOOP around the same window.

## Plan
N/A — resolved via a `human-steered` (halt + golden-replay) milestone editing `OUTER-LOOP.md`. Depends on
[[DIR-066-A]] landing first.

## Acceptance Criteria
- [ ] `grep -n 'HALT-RECOMMENDED' OUTER-LOOP.md` no longer shows a governance:product-ratio halt clause; the
      DIR-038-B bullet is gone or explicitly demoted to informational — pasted.
- [ ] SELECT step 1 now describes the Round-1 D-quota composition (grep for `deliverable`, `streak`,
      `composeShortlist`/`shortlist` → exit 0).
- [ ] The VT-slope (DIR-038-A) hard-halt input is still present and unchanged — diff shows no edit to that bullet.
- [ ] Golden-replay: chart-1's existing fixtures/selfchecks stay green, unchanged — diff pasted, empty on
      chart-1's own cells.
- [ ] `node scripts/it0-split-or-commit-check.ts .` + the standard non-flaky suite stay green.

## Definition of Done
Standard inherited-core DoD clauses apply. Per DIR-026 Reading A: the prose edit is necessary-not-sufficient —
done ONLY when the governor is OPERATIVE in a REAL SELECT.
- [ ] chart-2/VT untouched; only SELECT step 1 + the governance:product self-halt bullet changed — diff scoped.
- [ ] A REAL milestone's SELECT used the governor: the recorded Round-1 shortlist (per-candidate `deliverable`,
      streak, S) + the winner pasted, showing the quota constrained the choice (or considered-and-overridden
      with reason).
- [ ] DIR-038-B's hard governance:product halt is removed and cannot fire — verified by a real checkpoint that
      computes the ratio informationally without emitting `HALT-RECOMMENDED` from it.
- [ ] Authored `human-steered`: under `.halt` off-loop, golden-replay, independently adversarial-audited.
- [ ] On landing, [[DIR-066]] flips `dirStatus: applied` and [[DIR-065]] is dispositioned `superseded`.
- [ ] it0 DoD meta-enforcer passes all clauses.

## Execution record (human-steered driver edit LANDED — escrow open, 2026-07-23)

Edited `OUTER-LOOP.md` in a `.halt` window (方案乙). **Landed & verified now:**
- SELECT step 1 now carries the "Round-1 deliverable governor (DIR-066)" paragraph: (丙) `deliverable:yes|no`,
  streak (exempt = §4.5 mandatory slot), `composeShortlist` (`floor=min(1,streak/6)`, S_max=4, S∈[1,4]),
  the pure-soft `DELIVERABLE-STARVATION` signal (streak≥6 ∧ no autonomous D → visible, run best-N, never halt),
  and an explicit "Round 2 is unchanged" clause.
- The self-halt block's **governance:product→HALT-RECOMMENDED bullet is REMOVED** (DIR-038-B retired); demoted
  to an informational metric that no longer trips a halt. `grep 'HALT-RECOMMENDED' OUTER-LOOP.md` now shows only
  the VT-slope (DIR-038-A) hard input + the governor's own "emit no HALT-RECOMMENDED" + the explicit "does NOT
  trip" note.
- **Golden-replay clean:** VT-slope hard-halt bullet untouched; chart-1/VT fixtures unchanged — rolling-slope
  11/11, chart2-s1 20/20, DoD-fixture selfcheck 17/17, OUTER-LOOP ceiling gate PASS.

**Escrow OPEN (why this stays `todo`, per DIR-026 Reading A):** the two remaining DoD items need a REAL resumed
SELECT — (a) the governor must be exercised by a real milestone's SELECT (recorded shortlist + winner), which
also flips loadbearing-test-gate `[N/A]→[PASS]` for `deliverable-governor.ts`; (b) an independent adversarial
audit of this driver edit. Both fire on the first milestone after the loop resumes. **The cp-130 hard-halt risk
is already eliminated** by the removal above (that part is landed, not escrowed). On escrow close, [[DIR-066]] →
`dirStatus: applied` and [[DIR-065]] → `superseded`.
