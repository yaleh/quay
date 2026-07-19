---
id: FIX-FAIL-RES-DUP
title: "A5 violation: two ## Resolution headings (one an empty template)"
status: done
labels:
  - directive
parent: null
children: []
extra:
  schema: "v1"
  dirStatus: applied
---
## Proposal

This fixture isolates the A5 duplicate-Resolution failure — it carries TWO `## Resolution` headings:
an empty template stub plus a real one. The DIR-028 pathology (the empty `<!-- filled at close -->`
template left beside the real Resolution) must be caught.

## Acceptance Criteria

- [ ] a runnable check with an exit code.

## Definition of Done

- [ ] References the standard DoD clauses in inherited-core.md.

## Resolution

<!-- filled at close -->

## Resolution

- outcome: applied
- evidence: really landed, verified in commit def5678 with a round-trip PASS.
