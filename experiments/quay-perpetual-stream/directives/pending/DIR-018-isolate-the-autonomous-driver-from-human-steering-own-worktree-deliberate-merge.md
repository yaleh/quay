# DIR-018

- status: pending
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
<!-- added when moved to archive/, or updated in place if deferred:
- resolved_by: iteration-N / milestone M-NN
- outcome: applied | deferred | rejected
- evidence: pointer to the design doc / iteration report section / commit -->
