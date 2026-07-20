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