---
id: exp5-M-CRYST-C1
title: C1 [executable] Crystallize split-or-commit's SELECT-split rule +
  parent-done-iff-children from prose into gates (DIR-026 half-done)
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-CRYST
children: []
extra: {}
---
## Proposal
DIR-026's SELECT-split rule and parent-done-iff-children are prose only; make them executable checks (only needs-human-reason is a clause today).
## Acceptance Criteria
- [ ] A parent marked done with an unfinished child FAILS; a not-fully-completable SELECT without a split FAILS; fixtures pin both.
## Definition of Done
Real: a real milestone boundary is gated by these checks.