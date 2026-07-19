# DIR-023

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-19
- title: Layer 3 of switching exp5 onto the quay engine — adopt the lifecycle: ABSORB advances a real milestone to `done` via `quay complete` (run-gates→advance, engine-written status + GateEvent), and land a `quay run` proof-of-concept driving one real milestone on the exp5 board, so the SELECT→ABSORB→counter++ transition is engine-run, not a bare prose status write

## Finding

exp5's milestone completion (ABSORB → status write → `milestone_counter++`) is still
prose; `quay complete` (QENG-3) and `quay run` (QENG-4) are unused by the loop. The
milestone's `done` status is written by ad hoc prose/`task edit`, not by the engine
running its gates and advancing it. So the lifecycle stays off-engine even after
Layers 1-2.

## Requested action

1. **ABSORB completes via `quay complete`.** After the gate set is engine-run
   (DIR-021/022), `OUTER-LOOP.md` step 6/7 advances the milestone with
   `quay complete <milestone-task>` — which requires status `ready`, runs the
   acceptance/DoD gate, and on pass writes `status=done` + logs a `complete`
   GateEvent — replacing the bare `task edit --status done`. Honor the transition
   table (a milestone must be `ready` to complete).
2. **`quay run` POC on the real board.** Demonstrate `quay run --once` processing
   ONE real actionable exp5 milestone (status `ready` + its acceptance meter) end
   to end on the exp5 task board — the first real step toward `quay run` eventually
   driving the whole loop and replacing `OUTER-LOOP.md`'s prose (a later DIR).

## Acceptance Criteria (runnable)
- [ ] `quay complete <a-real-ready-exp5-milestone>` on pass sets `status=done`
  (`quay task view <id> --json` shows done) and logs a `complete` GateEvent
  (`quay gate-log <id> --json`); on a failing gate it exits 1 and leaves status
  unchanged.
- [ ] `quay run --once` (run at repo root) processes one real actionable exp5
  milestone on the live board and advances it via the engine (exit 0; the milestone
  moves to done).

## Definition of Done — REAL LANDING is the bar, not artifacts

**NOT done** when `quay complete`/`quay run` merely exist (they already do, QENG-3/4).
Done **ONLY** when a **REAL exp5 milestone was advanced to `done` BY `quay complete`**
(not a bare status write), verifiable by:
(a) a `complete` GateEvent for that real milestone's task id in `quay gate-log`, AND
(b) that milestone's `status=done` written by the engine (its ABSORB entry records
    the `quay complete` output), AND
(c) at least one real milestone processed by `quay run --once` on the live board.
A command that exists but was never used to complete a real milestone is NOT landed.
Stays `pending` until a real milestone's `done` came from the engine.

**Layer ordering (no leap-frogging).** The milestone that lands this DIR must ALSO have
its gate set engine-run per [[DIR-021]]/[[DIR-022]] — `quay complete` runs the gate set
and advances, so its `complete` GateEvent must sit alongside real `dod` + non-`dod` gate
GateEvents for that same task in the log. A `complete` written over a milestone whose
gates were still prose/`it0-*.sh` does not satisfy Layer 3.

## Human verification when exp5 marks this DIR done
1. `quay gate-log <a-real-milestone-task> --json` MUST show a `complete` GateEvent
   for a real milestone; its `done` status must be traceable to that `quay complete`.
2. Confirm `quay run --once` actually advanced a real milestone (not a demo task).
3. If `done` was written by `task edit --status done` prose with no `complete`
   GateEvent, it is NOT landed — send back.

## Resolution
<!-- added when moved to archive/, or updated in place if deferred -->
