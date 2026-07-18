# DIR-016

- status: applied
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: Make design→implementation drop-through impossible — require every design-only milestone's ABSORB to materialize a selectable `-IMPL` candidate row (never leave it as prose only), and retroactively sweep past design-only milestones that lack one

## Finding

The experiment has a recurring, structural failure mode: a **design-only milestone
completes, marks itself DONE, and defers its implementation to "a future SELECT"
in prose — but no selectable candidate row is created, so SELECT can never reach
it.** Because SELECT (`OUTER-LOOP.md` step 1) only considers non-DONE candidate
rows, a deferral with no row is a deferral to never. Evidence this conversation:

- `M-CLI-EDIT-PARITY` (design, DONE m14) → its ABSORB **did** create
  `M-CLI-EDIT-PARITY-IMPL`, SELECTed and completed at m16. ✅ the mechanism works.
- `M-TASK-BACKLOG-PROJECTION` (design, DONE m13) → **no `-IMPL` row created**;
  implementation exists only as prose + the design doc's §15 checklist; unselectable
  (see DIR-015).
- `M-TASK-TO-PLAN-SKILL-DESIGN` (design, DONE m17) → **no `-IMPL` row created**;
  its implementation (DIR-012 item 3) sat unqueued until DIR-014 was filed by hand.
- grep confirms the ONLY `-IMPL` row in the entire backlog is
  `M-CLI-EDIT-PARITY-IMPL`.

So whether a design milestone's implementation ever becomes reachable currently
depends on the ABSORB agent *remembering* to hand-author an `-IMPL` row — an
un-enforced convention. Two of three recent design milestones forgot. This is the
DIR-002 "enforcement half never built" pattern again, now applied to the loop's own
design→implementation hand-off: the implementation-follow-up channel exists in
practice (the m14→m16 precedent) but is nowhere required, so it silently fails.

## Requested action

Make the omission impossible, by rule and by mechanism (not just documentation):

1. **Amend the ABSORB step** (`OUTER-LOOP.md` step 6/ABSORB, and the reusable
   statement in `inherited-core.md`) so that when a milestone is **design-only**
   (its deliverable is a design doc / it produced a "Done-when clauses a future
   implementing milestone would need" section / it touched no product code and its
   own row is marked "design delivered"), its ABSORB **MUST** create a
   corresponding **selectable, non-DONE `<M-NAME>-IMPL` candidate row** in
   `backlog.md`, sourced to the design doc's §"Done-when clauses a future
   implementing milestone would need" checklist. Leaving the follow-up as prose
   only is not permitted. State the rule as a HARD step that blocks the ABSORB's
   completion / `milestone_counter++` if a design-only milestone finishes without
   its `-IMPL` row (same block shape as the existing V_meta-lag and adversarial-audit
   gates), so it cannot be skipped.
2. **Make it mechanically checkable, not just prose** (avoid re-creating the very
   pattern this DIR names): add a small check — e.g. an `it0`-style script, or fold
   into the drain/reconcile step — that flags any design-only milestone in the log
   whose `-IMPL` row is absent from `backlog.md`. Mirror the existing
   `scripts/it0-*.sh` convention (exit 0/1/2, fixture-testable). Without an
   enforcement half, this directive would itself be the pattern it warns about.
3. **Retroactive sweep.** Audit every past design-only milestone and create the
   missing `-IMPL` rows: at minimum `M-TASK-BACKLOG-PROJECTION-IMPL` (see DIR-015,
   the specific instance filed alongside this) and reconcile the task-to-plan
   skill's implementation (already tracked by DIR-014) into the same scheme, so the
   backlog's set of `-IMPL` rows exactly matches the set of design-only milestones
   that have not yet been implemented. Record which milestones the sweep touched.
4. **Also make each new `-IMPL` row visible in quay** once M-TASK-BACKLOG-PROJECTION
   is implemented (DIR-015) — i.e. these follow-ups should be projected as tasks,
   not just backlog prose, closing the loop with the self-hosting fix.

Value type: governance-integrity (closes a systemic drop-through in the loop's own
design→implementation hand-off) + risk/option (prevents future wasted design work
that never ships). Δv̂ ≈ 0 (method infra). This is the general rule; DIR-015 is its
first concrete instance. Interacts with DIR-014 (task-to-plan process) and the
DIR-009/010 self-hosting fix — all three are instances of "designed but never
materialized as selectable/executable work."

## Resolution
- resolved_by: M21-impl-row-enforcement, iteration-1, 2026-07-18
- outcome: applied — all four Requested-action items done
- evidence:
  - Item 1 (HARD BLOCK rule): `OUTER-LOOP.md` step 6 (ABSORB) amended with a new
    "Design-only-milestone impl-row gate" clause, placed and worded in the same
    HARD-BLOCK register as the existing V_meta consolidation-lag gate immediately
    above it and the adversarial-audit gate above that — blocks step 7's
    `milestone_counter++` until a design-only milestone's `-IMPL` row exists.
    `inherited-core.md` gained the equivalent reusable "Design-only-milestone
    impl-row rule" section (mirrors the gate's statement, scope note, and
    rationale independent of the `OUTER-LOOP.md` mechanized placement).
  - Item 2 (mechanical check): `scripts/it0-impl-row-check.sh` created, following
    the existing `it0-*.sh` 0/1/2 exit-code convention (0=PASS, 1=FAIL/FLAG,
    2=usage/file-not-found error). Fixture-tested against real backlog rows: PASS
    on `M-CLI-EDIT-PARITY` (has `-IMPL` row), FAIL on `M-TASK-BACKLOG-PROJECTION`
    (had none, before this same milestone's sweep created one), usage-error (exit
    2) on an unknown milestone id — see this milestone's
    `milestones/M21-impl-row-enforcement/iterations/iteration-1.md` for full
    pasted output.
  - Item 3 (retroactive sweep): `backlog.md` gained two new non-DONE rows —
    `M-TASK-BACKLOG-PROJECTION-IMPL` (satisfies DIR-015 item 1) and
    `M-TASK-TO-PLAN-SKILL-IMPL-PHASE7` (the script's own naming-convention
    verdict against `M-TASK-TO-PLAN-SKILL-DESIGN` was FAIL/absent; substantive
    review confirmed `M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP` (m20) covers Phase 6
    only and Phase 7 was tracked solely as prose + a still-pending DIR-014 with
    no row of its own, so a new row was created rather than judged
    not-applicable). Full disposition reasoning + script transcripts in this
    milestone's iteration-1 report.
  - Item 4 (visibility note): recorded, not built — `M-TASK-BACKLOG-PROJECTION-
    IMPL`'s own backlog row text states explicitly that DIR-016 item 4
    (projecting `-IMPL` rows into quay) depends on that row's own future
    implementation; no task-projection work was attempted by this milestone
    (out of scope per the charter's explicit non-goals, same DIR-009/010
    self-hosting-mechanism fence DIR-015 already draws).
  - Full detail: `experiments/quay-perpetual-stream/milestones/M21-impl-row-enforcement/iterations/iteration-1.md`.
