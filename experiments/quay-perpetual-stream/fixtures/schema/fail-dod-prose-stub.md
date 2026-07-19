---
id: FIX-FAIL-DOD-PROSE
title: "A4 violation: Definition of Done in prose, not a checklist"
status: todo
labels:
  - milestone-candidate
parent: null
children: []
extra:
  schema: "v1"
---
## Proposal

This fixture isolates the A4 failure: the `## Definition of Done` section is authored as prose with
NO GFM checkbox tokens, so it must FAIL dod-not-checklist even though it references the standard.

## Plan

N/A — fixture isolating the A4 failure only.

## Acceptance Criteria

- [ ] a concrete checkable criterion here.

## Definition of Done

Done per the standard five clauses in inherited-core.md, as a prose paragraph rather than a checklist.
