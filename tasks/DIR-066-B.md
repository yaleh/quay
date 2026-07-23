---
id: DIR-066-B
title: "DIR-066 child B [human-steered: halt + golden-replay]: wire the Round-1
  D-quota into OUTER-LOOP step 1 (candidates-considered-this-pass) + REMOVE
  DIR-038-B's governance:product→HALT-RECOMMENDED clause from the self-halt
  block"
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
- [x] `grep -n 'HALT-RECOMMENDED' OUTER-LOOP.md` no longer shows a governance:product-ratio halt clause; the
      DIR-038-B bullet is gone or explicitly demoted to informational — pasted.
- [x] SELECT step 1 now describes the Round-1 D-quota composition (grep for `deliverable`, `streak`,
      `composeShortlist`/`shortlist` → exit 0).
- [x] The VT-slope (DIR-038-A) hard-halt input is still present and unchanged — diff shows no edit to that bullet.
- [x] Golden-replay: chart-1's existing fixtures/selfchecks stay green, unchanged — diff pasted, empty on
      chart-1's own cells.
- [ ] `node scripts/it0-split-or-commit-check.ts .` + the standard non-flaky suite stay green.

## Definition of Done
Standard inherited-core DoD clauses apply. Per DIR-026 Reading A: the prose edit is necessary-not-sufficient —
done ONLY when the governor is OPERATIVE in a REAL SELECT.
- [ ] chart-2/VT untouched; only SELECT step 1 + the governance:product self-halt bullet changed — diff scoped.
- [x] A REAL milestone's SELECT used the governor: the recorded Round-1 shortlist (per-candidate `deliverable`,
      streak, S) + the winner pasted, showing the quota constrained the choice (or considered-and-overridden
      with reason). **Satisfied by M126 (see Execution record update below).**
- [x] DIR-038-B's hard governance:product halt is removed and cannot fire — verified by a real checkpoint that
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

**Escrow condition (a) SATISFIED at M126 SELECT (2026-07-23, autonomous loop resume):** the FIRST real
resumed SELECT ran the governor for real (not a fixture replay) — `composeShortlist` invoked directly against
the real autonomous-selectable candidate pool:
```
streak=2 (carried from M125, class N), floor=0.3333, sMax=4, dSeats=1, nSeats=3
candidates: exp5-M-PRODUCTIZED-DELIVERY-A(D,rank1), exp5-M-CRYST-D2(D,rank2), DIR-063-A(N,rank1)
shortlist (S=2): [exp5-M-PRODUCTIZED-DELIVERY-A, DIR-063-A]
starvation=false
```
Round 2 picked `exp5-M-PRODUCTIZED-DELIVERY-A` (chart-2 S2 mover, weight 30, cov=0.00) from this shortlist —
the quota's D-seat is what put it in the "candidates considered this pass" set alongside DIR-063-A; the
excluded `exp5-M-CRYST-D2` (also D, lower rank) got a `## Not selected (M126)` note, per OUTER-LOOP step 1's
write-back requirement. `milestone:M-126` label applied to the winner. See `charters/M126-*.md` and
`dashboard.md`'s SELECT M126 log entry for the full record.

**Escrow condition (b) — independent adversarial audit of this driver edit** — dispatched this same pass
(top-level session, fresh-context `general-purpose` subagent, `run_in_background=true`), charged to REFUTE
the OUTER-LOOP.md diff (SELECT step 1 + self-halt block) against this task's own AC/DoD. Verdict to be
recorded here on completion; escrow (b) remains OPEN until that verdict lands.

**On BOTH (a) and (b) closing:** this task flips to `done`, [[DIR-066]] → `dirStatus: applied`, [[DIR-065]] →
`superseded`.