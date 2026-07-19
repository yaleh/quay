---
id: exp5-M-QENG-DOD-DEMO-ONLY
title: "The QENG-5 'exp5 DoD via quay gate' wiring is demo-only (2 fixture
  tasks, QENG-5-DEMO-PASS/FAIL) — the REAL per-milestone DoD meta-enforcer
  gate at OUTER-LOOP.md step 6/7 still runs it0-dod-check.sh as a bare prose
  shell call, not through quay gate; decide whether/how to close that gap"
status: todo
labels:
  - milestone-candidate
  - surface:method-infra
  - milestone:M37-discover-post-qeng
extra: {}
---
## Provenance
Found during M37-discover-post-qeng's functional QENG survey (iteration-1, 2026-07-19) — direct
inspection of `OUTER-LOOP.md`'s DoD meta-enforcer gate paragraph plus the two QENG-5 fixture tasks
(`tasks/QENG-5-DEMO-PASS.md`, `tasks/QENG-5-DEMO-FAIL.md`) and live exercise of both
(`quay gate QENG-5-DEMO-PASS` → exit 0 PASS; `quay gate QENG-5-DEMO-FAIL` → exit 1 FAIL, both
confirmed live this survey, GateEvents logged).

## Source
`OUTER-LOOP.md` lines 322-334 ("Engine route (QENG-5 / epicd-engine-port...)" sub-note). The text
itself is honest about scope — it says the DEMO reproduces the pass/fail behavior "end-to-end" via
the two committed fixture tasks, and that `it0-dod-check.sh` "remains the underlying check" — but does
NOT claim (and this survey independently confirms it does not currently do) that any REAL milestone's
own ABSORB-time DoD gate actually runs through `quay gate <real-milestone-task>` rather than a bare
`bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh <id> <charter> <absorb>` shell
invocation as prose-directed by OUTER-LOOP.md step 6. Confirmed by reading the step 6 DoD
meta-enforcer gate text itself: it instructs "Run: `scripts/it0-dod-check.sh <milestone-id>
<charter-file> <absorb-entry-text-or-file>`" directly — not `quay gate <milestone-id>` — as the actual
per-milestone HARD BLOCK mechanism. `QENG-0`'s own "Progress" note is transparent about this too:
"Remaining forward work (a separate future initiative, not this epic): broaden the wiring so a
resumed exp5 loop drives ALL its gates/milestones via `quay gate/complete/run` rather than the one
demonstrated DoD path." This task makes that already-self-disclosed forward-work note concrete and
selectable rather than leaving it as a dangling prose aside inside a CLOSED epic's progress note (where
it is easy for a future SELECT pass to miss).

## Acceptance Criteria
- [ ] A concrete decision is made and recorded: EITHER (a) extend the wiring so a real milestone's
  ABSORB-time DoD check is invoked via `quay gate <real-milestone-task-id>` (requiring the real
  milestone task to carry `extra.acceptance` = the `it0-dod-check.sh <id> <charter> <absorb>` command,
  analogous to the two fixture tasks), with the resulting GateEvent queryable via `quay gate-log` as
  the ABSORB record's own evidence citation, OR (b) a reasoned decision that the current demo-only
  scope is intentionally sufficient for now (e.g. because ABSORB's `<absorb-entry-text-or-file>`
  argument is itself only fully known AFTER the ABSORB narrative is drafted, creating a chicken/egg
  ordering problem the fixture tasks' static committed content sidesteps) — either answer is
  acceptable, but the choice must be made explicitly, not left as an unexamined demo indefinitely.
- [ ] If (a) is chosen: at least one REAL (non-fixture) milestone's ABSORB is driven through
  `quay gate <task>` end-to-end, with the GateEvent log entry cited directly in that milestone's
  ABSORB record in `dashboard.md`, and `OUTER-LOOP.md` step 6's prose is updated to name
  `quay gate <milestone-task>` as the primary invocation (not just an "engine route" side-note).
- [ ] If (b) is chosen: `OUTER-LOOP.md`'s existing sub-note is left as-is but a forward-pointer is
  added noting this task's disposition and reasoning, so a future SELECT pass has a citable answer
  instead of re-discovering the same demo-only gap from scratch.
- [ ] Either way, the chicken/egg ordering problem named above (the ABSORB-entry-file argument not
  existing yet at gate-invocation time for a real, not-yet-written ABSORB) is explicitly addressed in
  whichever direction is chosen — this is the one concrete blocker distinguishing the fixture-task
  demo (static committed content) from a real milestone (content drafted live during ABSORB itself).

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present, 1
per-milestone acceptance audit, 2 V_meta-lag, 3 line-budget, 4 impl-row — decide at charter time
depending on whether (a) or (b) is chosen, 5 no-self-exemption, 6 escrow-Δv — N/A unless scoped
design-only, 7 test-floor — N/A if (b) chosen [no product code touched], APPLIES if (a) chosen
[touches `OUTER-LOOP.md`/task wiring, `surface:method-infra`]). No task-specific exemption from any
clause.

## Value type / cadence
governance-integrity (closes a self-disclosed "shelfware risk" the QENG-0 epic itself named as
remaining forward work) + explore (the chicken/egg ABSORB-ordering question is a genuinely open design
question, not a mechanical wiring task). Δv̂ small-to-moderate depending on which branch is chosen —
methodology/governance, likely no VT chart cell (mirrors the DoD-program lineage's own no-VT-cell
precedent), but real value in preventing the QENG-5 wiring from being cited as "done" when only 2
static fixture tasks, never a real milestone, have actually exercised it.
