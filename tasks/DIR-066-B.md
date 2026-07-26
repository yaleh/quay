---
id: DIR-066-B
title: "DIR-066 child B [human-steered: halt + golden-replay]: wire the Round-1
  D-quota into OUTER-LOOP step 1 (candidates-considered-this-pass) + REMOVE
  DIR-038-B's governance:product→HALT-RECOMMENDED clause from the self-halt
  block"
status: done
labels:
  - milestone-candidate
  - human-steered
parent: DIR-066
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-066-B
    experiments/quay-perpetual-stream/charters/M170-dir066-b-dquota-wiring.md
    /tmp/m170-absorb-entry.md
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
- [x] `node scripts/it0-split-or-commit-check.ts .` + the standard non-flaky suite stay green. (PASS — 428 tasks, no split-or-commit violations, 2026-07-26)

## Definition of Done
Standard inherited-core DoD clauses apply. Per DIR-026 Reading A: the prose edit is necessary-not-sufficient —
done ONLY when the governor is OPERATIVE in a REAL SELECT.
- [x] chart-2/VT untouched; only SELECT step 1 + the governance:product self-halt bullet changed — diff scoped.
      **(Re-verified 2026-07-26 by adversarial audit: `git diff 181696d~1..181696d -- OUTER-LOOP.md` shows only
      SELECT step-1 ¶ + self-halt block edits; no chart-2/VT/other files touched.)**
- [x] A REAL milestone's SELECT used the governor: the recorded Round-1 shortlist (per-candidate `deliverable`,
      streak, S) + the winner pasted, showing the quota constrained the choice (or considered-and-overridden
      with reason). **Satisfied by M126 (see Execution record update below).**
- [x] DIR-038-B's hard governance:product halt is removed and cannot fire — verified by a real checkpoint that
      computes the ratio informationally without emitting `HALT-RECOMMENDED` from it. **UN-TICKED 2026-07-23 —
      see "Audit finding + fix" below: this was self-ticked prematurely; the independent audit found the claim
      FALSE as of the original landing (the executable instrument still emitted HALT-RECOMMENDED text). A fix
      has now been applied; re-verification is pending, do not re-tick until the audit confirms.**
      **(RE-VERIFIED 2026-07-26 by adversarial audit: fix in commit `91c6206` confirmed on master —
      `haltInput→evaluateRatio`, `HaltResult→RatioReport`, `halt→breach`; breach message reads "INFORMATIONAL
      ONLY since DIR-066 ... does NOT trip HALT-RECOMMENDED"; selfcheck 4/4 PASS; unit tests 11/11 PASS;
      OUTER-LOOP.md lines 201-202 explicitly mark governance:product as INFORMATIONAL only with `¬trip
      HALT-RECOMMENDED`.)**
- [x] Authored `human-steered`: under `.halt` off-loop, golden-replay, independently adversarial-audited.
      **(Confirmed 2026-07-26: task carries `human-steered` label; execution record confirms `.halt` window;
      golden-replay verified by all selfchecks (DoD fixture 17/17, governance-ratio 4/4, rolling-slope 4/4,
      loadbearing 3/3, deliverable-governor 14/14); independent adversarial audit performed 2026-07-23
      (CONCERNS → fix → re-verified 2026-07-26, NO REFUTATION FOUND).)**
- [x] On landing, [[DIR-066]] flips `dirStatus: applied` and [[DIR-065]] is dispositioned `superseded`.
      **(Confirmed 2026-07-26: `quay task_get DIR-066` → `dirStatus: applied`; `quay task_get DIR-065` →
      `dirStatus: superseded` with DIR-066 cited as superseding directive.)**
- [x] it0 DoD meta-enforcer passes all clauses.
      **(Confirmed 2026-07-26: `it0-dod-check.sh DIR-066-B` exits 0, all 12 clauses PASS.)**

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

**Escrow condition (b) — independent adversarial audit — FIRST PASS RETURNED CONCERNS (2026-07-23).**
Dispatched a fresh-context `general-purpose` subagent, `run_in_background=true`, charged to REFUTE. Full
report: `/tmp/claude-1000/-home-yale-work-quay/71dee4da-cbf5-478c-83a5-e82a0ca7c749/scratchpad/dir066-b-audit.md`.
Dispatch record: agent id logged at `/tmp/m-dir066-b-dispatch-record.txt`.

**Verdict: CONCERNS.** Everything about the SELECT-step-1 mechanism and the self-halt prose edit checked
out (diff scope, VT-slope preservation, 14/14 governor tests, all cited selfchecks green). ONE real,
UNDISCLOSED defect found: `scripts/governance-product-ratio-check.ts` (the executable instrument a
checkpoint author actually runs) was NOT touched by the land commit — it still exported `haltInput`,
returned `{halt:true}`, exited 1, and printed the literal string `"...HALT-RECOMMENDED input"` on a real
breach (reproduced live against cp-125's own numbers, byte-identical to what's pasted in `checkpoints/
cp-125.md`). This directly falsified the DoD claim ("verified by a real checkpoint that computes the
ratio informationally without emitting HALT-RECOMMENDED") — only the OUTER-LOOP.md *prose* was fixed;
the *executable* was not. Classified UNDISCLOSED (nowhere mentioned in DIR-066/-A/-B).

**Fix applied same-pass (2026-07-23), orchestrator-authored (NOT a self-tick — the DoD box above stays
unchecked until the audit re-confirms):** edited `experiments/quay-perpetual-stream/scripts/
governance-product-ratio-check.ts` — renamed `haltInput`→`evaluateRatio`, `HaltResult`→`RatioReport`,
field `halt`→`breach`; the CLI's breach message no longer says "HALT-RECOMMENDED input", now reads
"INFORMATIONAL ONLY since DIR-066 ... does NOT trip HALT-RECOMMENDED"; header comment updated to note
DIR-066 supersession. Sibling test file updated to match (same assertions, renamed API). Re-ran:
```
$ node --test experiments/quay-perpetual-stream/test/governance-product-ratio-check.test.mjs
ℹ tests 11 / pass 11 / fail 0
$ bash experiments/quay-perpetual-stream/scripts/governance-product-ratio-selfcheck.sh
PASS: recorded window 8.27:1 → BREACH (exit 1)
PASS: healthy window → no breach (exit 0)
PASS: missing file → exit 2
PASS: all governance:product cases behaved as asserted.
$ echo '{"governance": 5605, "product": 13}' > /tmp/breach-window.json
$ node experiments/quay-perpetual-stream/scripts/governance-product-ratio-check.ts /tmp/breach-window.json
GOVERNANCE:PRODUCT = 5605:13 = 431.15:1 (threshold 5:1)
BREACH: governance:product exceeds 5:1 — INFORMATIONAL ONLY since DIR-066 (2026-07-23): reported at a
checkpoint, does NOT trip HALT-RECOMMENDED (DIR-038-B's hard-halt wiring was retired; see OUTER-LOOP.md's
self-halt section + DIR-066-B).
EXIT=1
```
Re-verification requested from the SAME audit agent (continuity of context, per this experiment's
established precedent of a single audit performing its own confirmed write-back — see M116/M124's own
disposition) — pending. Escrow (b) remains OPEN until that re-confirmation lands and the DoD box above is
ticked BY THE AUDIT, not by this orchestrator.

**On (a) satisfied + (b) re-confirmed:** this task flips to `done`, [[DIR-066]] → `dirStatus: applied`,
[[DIR-065]] → `superseded`.

## Execution record (M170 ABSORB — escrow closed, 2026-07-26)

**Milestone:** M170 · **Charter:** M170-dir066-b-dquota-wiring · **Iterations:** 0 (direct-to-master escrow close-out)
**Realized Δv:** 0 (governance-integrity, no chart-2 surface cell moves)
**Merge commit:** 1b1d6ee · **Audit verdict:** NO REFUTATION FOUND

**Outcome:** Escrow close-out verified. All 6 Done-when conditions confirmed on master:
1. SELECT step 1 Round-1 D-quota composition (deliverable, streak, composeShortlist) present in OUTER-LOOP.md
2. No governance:product HALT clause in self-halt block — demoted to INFORMATIONAL only
3. governance-product-ratio-check.ts emits INFORMATIONAL only, not HALT-RECOMMENDED (fix commit 91c6206)
4. VT-slope hard-halt input unchanged
5. All selfchecks green: DoD fixture 17/17, governance-ratio 4/4, rolling-slope 4/4, loadbearing 3/3, deliverable-governor 14/14
6. split-or-commit: 428 tasks, no violations
7. DoD meta-enforcer: all 12 clauses PASS
8. Tree hygiene: clean
9. Worktree/branch hygiene: clean

Escrow (a) satisfied at M126 SELECT (governor operative in real SELECT). Escrow (b) closed — prior CONCERNS finding (governance-product-ratio-check.ts still emitting HALT-RECOMMENDED) verified-eliminated by independent adversarial audit re-verification. DIR-066 → dirStatus: applied. DIR-065 → dispositioned superseded. Task status: done.