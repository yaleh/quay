---
id: FIX-DIR-NO-FINDING
title: "Directive task missing the required ## Finding section (RED fixture for A7)"
status: todo
labels:
  - directive
parent: null
children: []
extra:
  schema: "v1"
---
## Proposal

This fixture is a marked directive task that intentionally OMITS the `## Finding` section.
The /quay-directive template requires both `## Finding` and `## Requested action`; the absence
of `## Finding` alone must cause A7 to FAIL. Real approach text, past the placeholder floor.

## Requested action

Restore the missing Finding section so the directive is structurally complete. This directive
deliberately omits `## Finding` to isolate assertion A7's Finding-presence check.

## Acceptance Criteria

- [ ] A runnable check confirms the finding is documented and the directive is applied.

## Definition of Done

- [ ] References the standard DoD clauses in inherited-core.md; real-landing bar per DIR-026.
