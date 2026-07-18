---
id: exp5-M-OUTCOME-EVAL
title: "Outcome-based (job-to-be-done) evaluation: fixed real end-to-end
  task-board scenarios, binary pass/fail, dogfooding-gated"
status: todo
labels:
  - milestone-candidate
  - surface:cross-cutting
parent: null
children: []
extra: {}
---
## Forward-looking candidate provenance
Forward-looking milestone-candidate task, created by M24-task-backlog-projection-impl (design doc §6 forward-looking-creation scope, distinct from the historical backfill). Source: backlog.md row "M-OUTCOME-EVAL" (open, not yet backed by a task before this write).

## Source
DIR-001 item 3

## Value type / cadence
explore, method infra, no VT points

## Notes (verbatim from backlog.md)
Backlogged, not yet charter-ready — needs a concrete scenario list authored at SELECT time.

## Draft scenario list (authored @M27 SELECT, 2026-07-18, to break 3-pass staleness — see
Status-mirror history below; NOT itself a SELECT of this candidate, m27 = M-COMPETITIVE-BENCH)

Fixed real end-to-end task-board scenarios, binary pass/fail, dogfooding-gated (per DIR-001 item 3
and M-GATES's existing dogfooding evidence-gate, extended from "was polish done" to "does the
capability actually run end-to-end" for a real job-to-be-done, not a synthetic unit test):

1. **Author→execute a primitive task via CLI, native provider**: `quay task create` → `quay:author`
   Skill drives it todo→ready → `quay:execute` Skill drives it ready→done, using only the CLI +
   Skills, zero manual store.js edits. Pass = task reaches `done` with the Skill-driven transitions
   as the only human-visible actions; fail = any manual intervention required.
2. **Same job, GitHub provider**: identical scenario 1, `--provider github`, against a real issue
   in this repo. Pass = same end-state via the same Skills, proving the provider-parameterization
   (QN-029) actually transfers the job, not just the ABI surface.
3. **Compound/epic task drive-to-done**: create a parent task with 2+ children, drive each child
   done via `quay:execute`, confirm `task_check`'s childrenStatus() gate reports the parent
   completable and the parent itself reaches done — end-to-end, both providers (QN-035's own
   gh-5/6/7 fixture is a candidate real substrate, not a synthetic one).
4. **Web UI task-board round-trip**: open the served task board, advance a real task via the
   `action_buttons` UI (not the CLI), confirm the resulting state matches what `task_get` reports —
   proving the UI is a real alternate front-end to the same Provider-ABI job, not a demo shell.
5. **Cross-provider parent/children write** (M12-abi-parent-write's own capability, now real):
   reparent a task via `quay task write --parent`, confirm both providers reflect the change
   end-to-end (native: store.js; github: cross-issue body-checkbox mutation) — the actual job a
   real user re-organizing a backlog would do, not just an isolated ABI conformance test.

Binary pass/fail per scenario; dogfooding-gated means each MUST be driven by actually invoking the
real CLI/Skill/UI surface (not by calling internal functions directly) — mirrors M-GATES's existing
dogfooding discipline. A future charter selecting this candidate should treat these 5 as the
starting Done-when set, adding/pruning only with a stated reason.

## Status mirror
todo (open candidate, not yet selected/dispatched)

---
_2026-07-18T19:18:52.080Z_: Not selected @M24: DIR-015/DIR-016's standing hard floor already committed this SELECT pass to M-TASK-BACKLOG-PROJECTION-IMPL (self-hosting fix, blocks all future SELECT read-path work) — a governance/infra candidate whose own enabling half was itself unselectable until this milestone lands.

---
_2026-07-18_: Not selected @M25: DIR-017 Step 1 (M-DOD-META-ENFORCER) outranks — newly-unblocked load-bearing governance prerequisite; higher priority than this cross-cutting eval work this pass, which also still needs a concrete scenario list authored before charter-ready.

---
_2026-07-18_: Not selected @M26: still not charter-ready (needs a concrete scenario list authored
at SELECT time — deliberately not rushed as a rider on this pass). M-ADVERSARIAL-EVAL (DIR-001 item
4, charter-ready as-is) selected instead; DIR-001's own ordering used as tie-break.

---
_2026-07-18_: Not selected @M27, but scenario list now drafted (above) to break the 3-pass
staleness (M24/M25/M26 all deferred this candidate for the same "needs scenario list" reason —
recognized as a stagnation pattern, not a legitimate re-deferral each time). M-COMPETITIVE-BENCH
(DIR-001 item 5) selected instead this pass, continuing DIR-001's own stated ordering (item 5 next
since item 4 closed @M26 and item 3 — this candidate — still carries no forcing signal beyond the
ordering itself). This candidate is now charter-ready for a future SELECT with the 5-scenario draft
above as its starting Done-when set.
