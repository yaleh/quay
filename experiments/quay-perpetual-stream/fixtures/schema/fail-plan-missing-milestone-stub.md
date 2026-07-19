---
id: FIX-FAIL-PLAN
title: "A2 violation: milestone-candidate with no Plan"
status: todo
labels:
  - milestone-candidate
parent: null
children: []
extra:
  schema: "v1"
---
## Proposal

A milestone-candidate task MUST carry a `## Plan` section (a resolving docs/plans/*.md ref or an
N/A-with-reason). This fixture deliberately omits it to isolate the A2 failure for a milestone kind —
the companion directive-compliant-stub.md proves a directive with no Plan does NOT fail.

## Acceptance Criteria

- [ ] a concrete checkable criterion here.

## Definition of Done

- [ ] References the standard DoD clauses in inherited-core.md.
