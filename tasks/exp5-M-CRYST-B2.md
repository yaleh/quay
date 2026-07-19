---
id: exp5-M-CRYST-B2
title: B2 [executable] Task-schema validator (extend Clause 0 or a
  task-schema-check), fixture-pinned
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-CRYST
children: []
extra: {}
---
## Proposal
One executable validator asserts the B1 schema: required sections present, AC/DoD checklist-form, no status-mirror Resolution, no duplicated lifecycle line. Fixture-pinned. Replaces scattered prose shape-definitions.
## Acceptance Criteria
- [ ] A synthetic task missing Proposal / with prose DoD / with a status-mirror Resolution FAILS; a compliant one PASSES; fixtures wired into the selfcheck.
## Definition of Done
Real: the validator HARD-blocks a real non-conforming task at its gate.