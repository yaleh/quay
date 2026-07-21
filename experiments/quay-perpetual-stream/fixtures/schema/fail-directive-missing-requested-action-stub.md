---
id: FIX-DIR-NO-REQUESTED-ACTION
title: "Directive task missing the required ## Requested action section (RED fixture for A7)"
status: todo
labels:
  - directive
parent: null
children: []
extra:
  schema: "v1"
---
## Proposal

This fixture is a marked directive task that intentionally OMITS the `## Requested action` section.
The /quay-directive template requires both `## Finding` and `## Requested action`; the absence
of `## Requested action` alone must cause A7 to FAIL. Real approach text, past the placeholder floor.

## Finding

The directive lifecycle was split across two sources (a task file and a separate directives/*.md
file), creating drift between the authoritative record and its projection. This fixture isolates
assertion A7's Requested-action-presence check by providing the Finding but omitting the action.

## Acceptance Criteria

- [ ] A runnable check confirms the finding is documented and the directive is applied.

## Definition of Done

- [ ] References the standard DoD clauses in inherited-core.md; real-landing bar per DIR-026.
