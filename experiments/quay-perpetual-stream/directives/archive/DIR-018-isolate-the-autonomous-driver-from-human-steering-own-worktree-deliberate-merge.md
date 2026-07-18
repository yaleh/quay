# DIR-018

- status: applied
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: Isolate the autonomous driver from human steering — run the loop on its own branch/worktree and merge human-directed changes deliberately, so the two writers stop sharing `master` and racing (this session produced silent auto-merge content loss and a boundary projection-drift from exactly that collision)

## Finding

This is infrastructure, not a Definition-of-Done clause (see DIR-017), but it is a
high-priority prerequisite for reliable driving. Throughout this conversation the
autonomous exp5 loop and the human were **both committing to `master` in the same
working tree**, which produced concrete damage:

- A human-directed `proposal-to-plan` run and the loop's M17 milestone edited the
  same proposal file; the conflict **auto-resolved by taking one side wholesale**
  (`989e0cd`), silently discarding the other side's content into a merge that then
  mislabeled its own tree (documented in DIR-013).
- The loop held a **conflicted in-progress merge in the shared index** (M18,
  `inherited-core.md`) that twice blocked a human commit; the human's own files got
  swept into the loop's merge index and had to be decoupled by hand and committed in
  a polled "clean window".
- A boundary reconcile **missed regenerating DIR-013's projection** (task mirror
  stuck `pending` after the file went `applied`) — the kind of drift that a
  contended shared tree makes easy to miss.

"Effectively and reliably driving the mechanism" is undermined when the driver and
the steerer share one mutable `master`. The fix is isolation + deliberate merge, not
cleverer racing.

## Requested action

1. **Run the loop in its own isolation.** The autonomous OUTER loop should execute
   on its own branch (and/or a dedicated git worktree) rather than committing
   directly to the human-shared `master`. `OUTER-LOOP.md`'s DISPATCH/merge/ABSORB
   steps operate within that isolation; the existing per-iteration worktree pattern
   is a starting point but the point here is the OUTER driver's own commit stream,
   not just inner iterations.
2. **Human steering merges in deliberately.** Human-authored changes (DIRs,
   proposals, corrections) land via an explicit, reviewed merge at a boundary — never
   by racing the loop for the same `master`. Define the merge direction and cadence
   (e.g. human→a steering branch the loop drains at DRAIN step 0; loop→master only at
   its own boundaries).
3. **No silent content-dropping merges.** Conflict resolution must never auto-take
   one side wholesale and discard the other without a recorded reconciliation note
   (the DIR-013 failure). If an auto-merge is conflict-free but semantically
   inconsistent (the M18 `OUTER-LOOP.md` case), the standing checks (DIR-017) should
   catch it.
4. Keep it mechanically checkable and minimal — do not build a heavy branching
   process; the goal is only to stop the two writers from corrupting each other.

Value type: risk/option (prevents a whole class of silent record corruption) +
governance-integrity. Δv̂ ≈ 0 (infra). High priority: every future human steering
session races the loop until this lands.

## Human verification when exp5 marks this DIR done

1. **The loop no longer commits to `master` directly** — inspect recent history:
   the autonomous milestones land on a loop branch / merge deliberately, not
   interleaved with human commits on `master`.
2. **Reproduce the race, expect no damage:** make a small human edit to a file the
   loop also touches, during a loop cycle — confirm it is NOT silently overwritten,
   and that any conflict surfaces a recorded reconciliation note rather than a
   wholesale auto-take.
3. **Merge direction is documented** in `OUTER-LOOP.md` (where human changes enter,
   where the loop publishes) and matches what the history shows.
4. **A conflict-free-but-inconsistent auto-merge is caught** — verify the standing
   check (DIR-017) or a dedicated check would flag the M18-class silent inconsistency,
   not just textual conflicts.
5. If the loop is still committing to shared `master` and you still have to poll for
   "clean windows" to commit, it is not done regardless of the mark.

## Resolution
- resolved_by: M23-outer-driver-isolation, iteration-0, 2026-07-18
- outcome: applied — all 4 Requested-action items done, dogfooded on this milestone itself
- evidence:
  - Item 1 (run the loop in its own isolation): dedicated branch `exp5-outer-driver` created
    from `master` HEAD at the m22→m23 boundary (`e3602c6`, the SELECT commit authoring this
    milestone's own charter). `OUTER-LOOP.md` step 5 (DISPATCH INNER) amended: per-iteration
    worktrees are now created off `exp5-outer-driver` HEAD, not `master` HEAD directly — the
    existing `milestones/M<NN>/worktrees/iteration-{0,1}` pattern is unchanged, only its base
    point moved, per the charter's explicit non-goal against re-architecting the worktree pattern
    itself.
  - Item 2 (human steering merges in deliberately): `OUTER-LOOP.md` step 0 (DRAIN) gained an
    explicit "Master → driver merge sub-step" — before SELECT, the loop deliberately
    fast-forwards/merges `master` → `exp5-outer-driver`, the only point human-authored commits
    (via `/quay-directive`, manual edits, etc.) enter the driver's own history. Step 6/7 (ABSORB)
    gained the mirror-image "Driver → master publish sub-step" — after the adversarial-audit,
    V_meta consolidation-lag, and design-only-milestone impl-row HARD BLOCKs all clear, the loop
    publishes via exactly one `git merge --no-ff exp5-outer-driver` onto `master` — the ONLY point
    the loop's own work lands on `master`. Merge direction and cadence are now documented
    verbatim in `OUTER-LOOP.md` text (satisfies the DIR-018 "Human verification" checklist item 3).
  - Item 3 (no silent content-dropping merges): `OUTER-LOOP.md` step 0 gained an explicit
    "No-silent-drop reconciliation-note requirement" standing instruction, applying to BOTH merge
    directions (master→driver at DRAIN, driver→master at ABSORB) — per-file conflict resolution,
    both sides read, a reconciliation note recorded in the relevant step's log entry; a blanket
    `checkout --ours`/`--theirs` without reading both sides is explicitly named as the DIR-013
    failure mode this rule exists to prevent. A missing/blank reconciliation note is stated as not
    a valid resolution, mirroring the V_meta-lag/`-IMPL`-row gates' existing "no silent deferral"
    discipline. The M18-class conflict-free-but-inconsistent-merge failure mode (DIR-018 human-
    verification item 4) remains covered by the existing DIR-017-adjacent standing checks
    (`OUTER-LOOP.md`'s recorded M18 lesson under "Lesson recorded (DIR-013 ...)"), unchanged by
    this milestone — DIR-017's own meta-enforcer scope is explicitly out of scope here per the
    charter's non-goals.
  - Item 4 (keep it minimal, mechanically checkable, not a heavy process): no new script or
    pre-commit hook was built — both new sub-steps are documented convention in `OUTER-LOOP.md`
    prose, applied by the loop reading the text (the charter's explicit non-goal against automated
    enforcement). A future milestone may add mechanical enforcement if drift is observed
    (`OUTER-LOOP.md`'s own text says so).
  - Dogfooded proof (charter in-scope item 5 / Done-when clauses 5-6): this milestone's own two
    iteration worktrees (`exp5-m23-iteration-0`, `exp5-m23-iteration-1`) were created off
    `exp5-outer-driver` HEAD (`e3602c6`), not `master` — see `git worktree list` output in
    `milestones/M23-outer-driver-isolation/iterations/iteration-0.md`. The actual
    `exp5-outer-driver` → `master` publish merge is performed by the orchestrator after both
    iterations are merged into the driver branch, per the charter's dispatcher notes — this
    iteration report documents the merge sequence and demonstrates its pieces without executing
    the final publish itself.
  - Full detail: `experiments/quay-perpetual-stream/milestones/M23-outer-driver-isolation/iterations/iteration-0.md`.
