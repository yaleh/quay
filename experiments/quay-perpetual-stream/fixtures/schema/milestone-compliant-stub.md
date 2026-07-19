---
id: FIX-MS-COMPLIANT
title: "Compliant milestone-candidate task (marked, all six assertions pass)"
status: todo
labels:
  - milestone-candidate
parent: null
children: []
extra:
  schema: "v1"
---
## Proposal

Introduce a canonical task-schema check as one shared module plus a standalone CLI, wired into the
authoring sources so the schema is emitted by construction. The validator is the schema; there is no
second hand-authored schema document. This is real approach text well over the placeholder floor.

## Plan

N/A — small self-contained method-infra change, no staged docs/plans record required.

## Acceptance Criteria

- [ ] `task-schema-check.mjs tasks/*.md` exits 0 with F=0 and N=P+L accounting closed.
- [ ] Every fixture behaves as asserted by task-schema-selfcheck.sh (exit 0).

## Definition of Done

- [ ] References the standard DoD clauses in inherited-core.md (the five/nine clauses), not a copy.
- [ ] Net-subtractive at the authoring sources: retired templates > added lines.
