---
id: FIX-FAIL-AC-PROSE
title: "A3 violation: Acceptance Criteria in prose, not a checklist"
status: todo
labels:
  - milestone-candidate
parent: null
children: []
extra:
  schema: "v1"
---
## Proposal

This fixture isolates the A3 failure: the `## Acceptance Criteria` section is authored as prose /
plain numbered lines with NO GFM checkbox tokens, so it must FAIL ac-not-checklist.

## Plan

N/A — fixture isolating the A3 failure only.

## Acceptance Criteria

1. The check exits 0 when everything passes.
2. The summary accounting closes.

## Definition of Done

- [ ] References the standard DoD clauses in inherited-core.md.
