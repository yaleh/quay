---
id: exp5-M-CRYST-B4
title: B4 Migrate existing tasks to the canonical schema (or forward-only +
  validator flags legacy)
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-CRYST
children: []
extra: {}
---
## Proposal
Bring existing tasks to the B1 schema (add Proposal where milestone tasks lack it, DoD→checklist, strip status-mirror Resolutions), or adopt forward-only with the validator flagging legacy.
## Acceptance Criteria
- [ ] B2 validator passes (or explicitly grandfathers pre-cutover tasks) across the live board.
## Definition of Done
Real: the board is schema-consistent (or heterogeneity is validator-tracked, not silent).