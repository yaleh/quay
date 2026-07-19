---
id: FIX-FAIL-RES-MIRROR
title: "A5 violation: bare status-mirror Resolution (no evidence)"
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

This fixture isolates the A5 status-mirror failure — the single `## Resolution` section body is a
lone `- outcome: applied` restating status with NO evidence. Evidence belongs in an `## Execution
record`; a bare status mirror under Resolution must FAIL.

## Acceptance Criteria

- [ ] a runnable check with an exit code.

## Definition of Done

- [ ] References the standard DoD clauses in inherited-core.md.

## Resolution

- outcome: applied
