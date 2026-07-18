# M21-impl-row-enforcement

**Milestone:** M21 · **Backlog id:** M-IMPL-ROW-ENFORCEMENT · **Type:** explore
**Value type:** governance-integrity (primary) + risk/option (secondary), per `inherited-core.md`'s
Value-typed SELECT ledger.
**Δv̂ = 0** (method infra — no VT chart cell; mirrors M13/M14/M17/M18/M19/M20's zero-VT precedent for
governance/methodology-infra milestones). Metric `Y`: none (no chart-cell mapping attempted, stated
explicitly per the same discipline M16/M20 used rather than fabricating a number).
**Source:** DIR-016 (human-authored, committed independently as `eb21de9` during M20's own
dispatch/merge window — drained at this m20→m21 SELECT boundary). Filed together with DIR-015
(the specific first instance this milestone's retroactive sweep resolves).

## HARD GATES (Tier-A, cited BY REFERENCE — §3.1, DIR-009 defense; M06-sizing by-reference form)

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Verify: `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference
charters/M21-impl-row-enforcement.md`. The dispatched iteration-executor agent's own prompt
must still contain the LITERAL gate text in full (resolved from `GATE-HASH-REF` by the dispatcher
before agent spawn) — the by-reference form only shrinks this charter file, never the agent prompt.

## Problem (DIR-016's finding, condensed — read the full directive for complete evidence)

Design-only milestones defer implementation to "a future SELECT" in prose, but SELECT
(`OUTER-LOOP.md` step 1) only considers non-DONE backlog rows — a deferral with no row is a
deferral to never. Evidence: `M-CLI-EDIT-PARITY` (design, DONE m14) correctly got an `-IMPL` row
(SELECTed and closed at m16); `M-TASK-BACKLOG-PROJECTION` (design, DONE m13) did NOT (see DIR-015);
`M-TASK-TO-PLAN-SKILL-DESIGN` (design, DONE m17) did NOT (its follow-up sat unqueued until DIR-014
was hand-filed). The ONLY `-IMPL` row in the whole backlog, before this milestone, is
`M-CLI-EDIT-PARITY-IMPL`. This is the DIR-002 "enforcement half never built" pattern recurring at
the loop's own design→implementation hand-off.

## Scope — in-scope items (DIR-016's 4 requested-action items, all four in this single milestone;
charter stays under the small-milestone norm, no phase/stage plan needed — this is prose-rule +
one small script + backlog edits, not a multi-phase build)

1. **HARD BLOCK rule.** Amend `OUTER-LOOP.md`'s ABSORB step (step 6) and the reusable statement in
   `inherited-core.md`: when a milestone is design-only (its Done-when includes a "Done-when clauses
   a future implementing milestone would need" section, or its own backlog row states "design
   delivered"/"design-doc only"), its ABSORB MUST create a selectable non-DONE `<M-NAME>-IMPL`
   backlog row before `milestone_counter++` in step 7 may execute — same HARD BLOCK shape/placement
   as the existing V_meta consolidation-lag gate (step 6, blocks step 7) and the adversarial-audit
   gate (step 6, blocks the VT-append/Done-when-complete claim). State it as unambiguously blocking,
   not advisory.
2. **Mechanical check.** A new `scripts/it0-impl-row-check.sh` (mirror the existing `it0-*.sh`
   exit-code convention: 0=pass, 1=flag/fail, 2=usage error; fixture-testable) that, given a
   milestone id + its backlog row text (or scanned from `dashboard.md`'s ABSORB log + `backlog.md`),
   flags a design-only milestone whose corresponding `-IMPL` row is absent. Must have at least one
   PASS fixture and one FAIL fixture demonstrated in the iteration report (not just described).
3. **Retroactive sweep.** Create the missing `-IMPL` backlog rows for every past design-only
   milestone currently lacking one: at minimum `M-TASK-BACKLOG-PROJECTION-IMPL` (sourced to DIR-015
   + the m13 design doc `docs/proposals/exp5-task-backlog-primitive-projection.md` §15's Done-when
   checklist — this SATISFIES DIR-015 item 1 as a byproduct; DIR-015 item 2, actually implementing
   the design, is intentionally left as the new row's own future SELECT work, NOT built this
   milestone). Reconcile `M-TASK-TO-PLAN-SKILL-DESIGN`'s (m17) implementation follow-up into the
   same scheme: confirm it is already adequately tracked by the existing (already-selected-and-
   partially-closed) `M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP` row + DIR-014's still-pending Phase 7 ask,
   OR add an explicit `M-TASK-TO-PLAN-SKILL-IMPL-PHASE7` row if the sweep's own check script would
   otherwise flag it as missing — run the new script against it and let its verdict decide, don't
   guess. Record in the iteration report exactly which milestones the sweep touched and why each
   verdict (row exists / row created / row judged not-applicable) was reached.
4. **Visibility note (not implementation).** DIR-016 item 4 ("make each new `-IMPL` row visible in
   quay once M-TASK-BACKLOG-PROJECTION is implemented") is explicitly a FUTURE dependency on
   `M-TASK-BACKLOG-PROJECTION-IMPL` (item 3's own new row) — this milestone must record that
   dependency explicitly in the new row's own backlog text, but must NOT attempt task-projection
   work itself (that is exactly the out-of-scope DIR-009/010 mechanism DIR-015/§Non-goals already
   fences off from this class of directive).

## Non-goals (explicit — do not attempt)

- Do NOT implement `M-TASK-BACKLOG-PROJECTION`'s design itself (DIR-015 item 2) — only materialize
  its selectable row.
- Do NOT build DIR-014's Phase 7 (plan step, TDD gate, DISPATCH wiring, non-discretionary diversity
  policy) — that is separately tracked, unaffected by this milestone.
- Do NOT retroactively re-open or re-score any already-DONE milestone's realized Δv.

## Done-when (binary)

1. `OUTER-LOOP.md` step 6 (ABSORB) contains an explicit HARD BLOCK clause requiring a design-only
   milestone's `-IMPL` row before `milestone_counter++`, in the same imperative/blocking register as
   the V_meta-lag and adversarial-audit gates already there — paste the added text.
2. `inherited-core.md` contains the equivalent reusable rule statement (not just `OUTER-LOOP.md`) —
   paste the added section.
3. `scripts/it0-impl-row-check.sh` exists, is executable, follows the 0/1/2 exit-code convention,
   and its PASS + FAIL fixture runs are pasted with real output (not described).
4. `backlog.md` contains a new `M-TASK-BACKLOG-PROJECTION-IMPL` row (non-DONE, selectable),
   sourced to DIR-015 + the m13 design doc's §15 checklist.
5. The sweep's disposition for `M-TASK-TO-PLAN-SKILL-DESIGN`'s follow-up is recorded explicitly
   (row exists / row created / judged not-applicable, with the script's own verdict pasted as
   evidence) — not silently skipped.
6. `git diff --stat <pre-charter-base-commit>` confirms the change is scoped to `OUTER-LOOP.md`,
   `inherited-core.md`, the new script, `backlog.md`, and this milestone's own iteration
   report/dashboard bookkeeping — no unrelated files touched.
7. Full existing test suite run (if any test harness covers `scripts/`) passes, or explicitly
   stated N/A with reason if no test harness covers shell scripts in this repo (mirror how prior
   `it0-*.sh` scripts were verified — direct fixture runs are acceptable evidence per that
   precedent).
8. This milestone's own charter/iteration-report/backlog/dashboard bookkeeping additions are
   permitted under clause 6's scope carve-out (same convention as every prior milestone).

## Inner termination (§3.2, five conditions — unchanged from prior milestones)

Done-when-complete & stable≥1 iter | ΔV<0.02 both layers K=2 consecutive | ceiling→redesign-OR-stop
| budget≈10 backstop | external HALT.

## it0 systematic-explore checks (run before dispatch)

- (a) ceiling/floor arithmetic — N/A in the `it0-ceiling-check.sh` sense (that script checks exp4's
  gap-list.md; DIR-015/DIR-016 are exp5 directives, not exp4 gaps). Confirmed OPEN/pending directly:
  both files exist under `directives/pending/`, `status: pending`, per this SELECT's own drain step.
- (b) gate-hash check: `scripts/it0-gate-hash-check.sh --by-reference charters/M21-impl-row-enforcement.md`
- (e) plan-time line-budget gate: `scripts/it0-ceiling-line-budget-check.sh charters/M21-impl-row-enforcement.md`
  — expect PASS (small-milestone norm, no phase/stage plan needed).

## Dispatcher notes

Two independent inner iterations, standard pattern: iteration-0 builds; iteration-1 independently
re-derives from this charter + DIR-015/DIR-016 + `OUTER-LOOP.md`/`inherited-core.md`'s current text,
explicitly told NOT to read iteration-0's materials. Worktrees at
`milestones/M21-impl-row-enforcement/worktrees/iteration-{0,1}`, branches
`exp5-m21-iteration-{0,1}`, off master HEAD at dispatch time. Since this milestone fully resolves
DIR-016 (all 4 items in scope), each iteration should move
`directives/pending/DIR-016-*.md` to `directives/archive/DIR-016-*.md` with a filled-in
`## Resolution` section (resolved_by/outcome/evidence), mirroring the DIR-013 precedent (iteration-0
handled its own directive's archival as part of its deliverable at M19). DIR-015 stays `pending` —
this milestone only resolves its item 1 (row creation); do NOT archive DIR-015, only note in its
file (or leave for a future milestone to note) that item 1 is now satisfied by the new backlog row. Given this milestone touches the
loop's own governing documents (`OUTER-LOOP.md`, `inherited-core.md`), both iterations are likely to
produce heavily overlapping (possibly full-file) diffs on those two files plus the new script and
the new backlog row — apply the established wholesale-selection conflict-resolution heuristic
(prefer the iteration whose report documents catching a real defect during self-testing) if both
diverge non-trivially at merge time, consistent with M16-M20 precedent.
