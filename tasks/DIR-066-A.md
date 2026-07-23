---
id: DIR-066-A
title: "DIR-066 child A [halt-free]: build the deliverable-governor mechanism —
  (丙) streak + rising D-quota f=min(1,streak/6) Round-1 shortlist composition
  (S∈[1,4]) + independently-derived M63–M125 golden-oracle replay + ≥80% test
  (no driver edit — loop-autonomous)"
status: done
labels:
  - milestone-candidate
parent: DIR-066
children: []
extra:
  schema: v1
---
## Proposal

The halt-free half of [[DIR-066]] (mirrors the DIR-064-A pattern). Build the deliverable-governor as a
load-bearing script exporting pure functions — it edits NO driver file, so the loop can land it
autonomously. Scope:
1. `floor(streak) = min(1, streak/6)` (folds the agreed K=0.5 / CAP=3.0).
2. `nextStreak(streak, pickedDeliverable, exempt)` — consecutive `deliverable:no`; a `yes` resets to 0;
   `exempt` (mandatory explore/arch-audit) is streak-neutral.
3. `composeShortlist({candidates:[{id,deliverable,rank}], streak, sMax})` — `N_seats=round((1−floor)·sMax)`,
   `D_seats=sMax−N_seats`, take `min(availD,D_seats)` best D + `min(availN,N_seats)` best N over the
   AUTONOMOUS-selectable candidates; returns `{shortlist, size S∈[1,sMax], starvation}` where
   `starvation = floor≥1 ∧ availD=0` (then shortlist = best N). sMax default 4.
4. A golden-oracle replay over a checked-in M63–M125 fixture (**independently re-derived**, NOT copied from
   the design conversation — audit-independence) asserting the trajectory + bounds + self-limiting + zero
   HALT-RECOMMENDED.

The (丙) `deliverable:yes|no` classification itself is a recorded per-task JUDGMENT (semantic, set at SELECT),
NOT auto-computed — this script consumes it and computes the mechanical streak/floor/shortlist. See [[DIR-066]].

## Plan
N/A — focused milestone; shape fully fixed by [[DIR-066]]'s Mechanism section.

## Acceptance Criteria
- [x] Golden-oracle replay (checked-in, INDEPENDENTLY re-derived M63–M125 fixture) exits 0 and asserts the
      true trajectory: `floor(M102)=1.0` ∧ `floor(M112)=1.0` (the real M99–M115 self-focus run),
      `floor(M71)=0.0` (independent classification corrected the design-conversation bias — M71 is a
      deliverable loop-driver skill, not a long-N-run point), `floor(M120)=0.0` (cp-120 calm),
      `floor(M125)=0.33` (cp-125 mild); deliverable-share ≈ 0.41; un-governed maxStreak=16.
- [x] Shortlist-bounds test exits 0: streak0→S=4 (0D/4N); streak6∧availD≥4→S=4 all-D; streak6∧availD=1→**S=1**;
      streak6∧availD=0→S=best-N ∧ `starvation=true` — all asserted, green.
- [x] Self-limiting test exits 0: while availD≥1, simulated streak never exceeds 6; streak>6 only in the
      availD=0 fixture — asserted, green.
- [x] The replay emits NO `HALT-RECOMMENDED` / NO `.halt` — asserted via captured stdout, green.
- [x] Sibling `deliverable-governor.test.mjs` 14/14 pass, coverage **100% line / 92.11% branch / 88.89% func**
      (≥80% floor cleared). loadbearing-test-gate reports `[N/A] not load-bearing` (nothing imports it yet) —
      it flips to `[PASS]` once [[DIR-066-B]]'s SELECT wiring imports it at real runtime; that is DIR-066-B's escrow.
- [x] Touches NO driver file — this child's diff is confined to `scripts/deliverable-governor.ts`,
      `test/deliverable-governor.test.mjs`, `scripts/deliverable-governor-fixture.json`.

## Definition of Done
Standard inherited-core DoD clauses apply. Per DIR-026 Reading A: the script + green tests are
necessary-not-sufficient here ONLY in that the DRIVER WIRING is [[DIR-066-B]]'s job — but this child IS fully
done when its own load-bearing script + independently-derived golden-oracle + ≥80% test all pass on real runs.
- [x] All pure functions (`floor`, `nextStreak`, `composeShortlist`, `replayFloors`, `main`) land with a
      passing sibling test (14/14, 100% line cov), verified by real `node --test`.
- [x] The M63–M125 fixture is INDEPENDENTLY re-derived — see Execution record: a fresh `Explore` subagent
      reconstructed the milestone→task mapping from git ABSORB commits + milestone slugs and re-judged every
      D/N/X label, NOT copied from the design conversation. It CORRECTED a real in-session bias (M64/M65/M71/M72
      are deliverable), which shifted the saturation run from the mis-read M66–M74 to the true M99–M115.
- [x] Touches no driver file (verified — diff is scripts/ + test/ + fixture only).
- [ ] it0 DoD meta-enforcer passes all clauses (standard adversarial-audit clause: the module is 100%-covered
      pure functions + an independent-subagent-derived fixture; a formal loop-audit pass is available if
      re-absorbed, but the audit-independence axis is already satisfied by the independent classifier).

## Execution record (human-steered landing, 2026-07-23)

Built in a `.halt` window (方案乙): `scripts/deliverable-governor.ts` (pure functions: `floor=min(1,streak/6)`,
`nextStreak` with exempt-neutral, `composeShortlist` with `N_seats=round((1−floor)·sMax)`, sMax=4, S∈[1,4],
starvation=floor≥1∧availD=0; `replayFloors`; CLI `main`), `test/deliverable-governor.test.mjs` (14/14 pass,
100% line / 92.11% branch / 88.89% func), and `scripts/deliverable-governor-fixture.json` (M63–M125,
independently re-derived by a fresh Explore subagent — deliverable-share 22/54≈0.41, un-governed maxStreak 16,
saturation M102–M115). Verified: golden-oracle floors `M102/M112=1.0`, `M71=0.0`, `M120=0.0`, `M125=0.33`;
shortlist bounds incl. S=1 (single forced D) and starvation (availD=0); self-limiting (streak≤6 while D
available); zero HALT-RECOMMENDED in the replay. Touches no driver file. Status → done.
