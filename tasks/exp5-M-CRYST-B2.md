---
id: exp5-M-CRYST-B2
title: B2 [executable] Task-schema validator (extend Clause 0 or a
  task-schema-check), fixture-pinned
status: done
labels:
  - milestone-candidate
  - crystallization
  - milestone:first-wave
parent: exp5-M-CRYST
children: []
extra:
  schema: "v1"
---
## Proposal
One executable validator asserts the B1 schema: required sections present, AC/DoD checklist-form, no status-mirror Resolution, no duplicated lifecycle line. Fixture-pinned. Replaces scattered prose shape-definitions.
## Plan
N/A — implemented directly as `scripts/task-schema.mjs` (single-source module) + `task-schema-check.mjs` CLI + fixtures; no staged docs/plans doc warranted for one validator module.
## Acceptance Criteria
- [ ] A synthetic task missing Proposal / with prose DoD / with a status-mirror Resolution FAILS; a compliant one PASSES; fixtures wired into the selfcheck.
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [ ] The validator HARD-blocks a real non-conforming task at its gate (not just a fixture).
- [ ] Fixtures pin every assertion; `task-schema-selfcheck.sh` exits 0.