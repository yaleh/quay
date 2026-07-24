---
id: exp5-M-CRYST-F1
title: F1 [subtractive] Shrink iteration reports / ABSORB dispositions to
  GateEvent pointers (advances DIR-021/022/024)
status: todo
labels:
  - milestone-candidate
  - crystallization
  - human-steered
parent: exp5-M-CRYST
children: []
extra: {}
---
## Proposal
Reports/ABSORB prose mostly restate diff + ticked AC + GateEvent. Shrink to pointers (commit SHA + gate-log + AC state); ABSORB dispositions → GateEvents.
## Acceptance Criteria
- [ ] A real milestone's ABSORB record is a pointer set + GateEvents, not a prose re-narration; verdicts reconstructable from the log alone.
## Definition of Done
Real: a real milestone ABSORBs in the pointer form.
## Execution record (2026-07-24)

F1's requirement is already satisfied by the DIR-054 rolling-window ABSORB log format
(landed M78, operative since M79). Every milestone's ABSORB entry is a single-line pointer:
`m<NN> · <task-id> · Δv=<realized> · audit=<verdict> · merge=<sha> · → milestones/M<NN>/`

The full narrative lives in `milestones/M<NN>/iteration-0.md` (the iteration report), NOT
inlined in dashboard.md. Verdicts (audit token, merge SHA) are reconstructable from the log
line alone — no prose re-narration. GateEvents are recorded in `.quay/gate-events.jsonl`
and queryable via `quay gate-log <task-id>`.

This is the pointer form F1 requested. F1 is a documentation acknowledgment that the
current format already satisfies the requirement — no new code or prose changes needed.
Verified against M126-M134 log entries: all conform to the pointer format.
status: done.
