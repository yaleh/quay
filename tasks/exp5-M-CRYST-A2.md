---
id: exp5-M-CRYST-A2
title: A2 [subtractive] Unify directive/task id namespace on exp5- prefix; clean
  foreign experiment-4 DIR-004/005 dangling scaffolding (DIR-010 residue)
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-CRYST
children: []
extra: {}
---
## Proposal
Unify all exp5 directive/task ids on the exp5- prefix; retire bare/experiment-4-colliding ids and their dangling Source/dirFile. Closes the DIR-010 cross-experiment namespace residue.
## Acceptance Criteria
- [ ] No exp5 directive task shares a bare id with a foreign experiment-4 task; `grep -lE '^Source:|dirFile:' tasks/DIR-*.md` on exp5 tasks is empty.
## Definition of Done
Real: the id space is unambiguous on the live board; foreign tasks relabeled/removed, no exp5 collision.