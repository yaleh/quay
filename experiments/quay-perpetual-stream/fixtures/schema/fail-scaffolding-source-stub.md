---
id: FIX-FAIL-SCAFFOLD-SOURCE
title: "A6 violation: leading Source: `experiments/ scaffolding body line"
status: done
labels:
  - directive
parent: null
children: []
extra:
  schema: "v1"
  dirStatus: applied
---
Source: `experiments/quay-perpetual-stream/directives/archive/DIR-XXX-some-directive.md`

## Proposal

This fixture isolates the A6 Source-line scaffolding failure — a leading body line that STARTS with
`Source: \`experiments/`, the foreign experiment-4 projection-scaffolding fingerprint. It must FAIL
scaffolding-source-line.

## Acceptance Criteria

- [ ] a runnable check with an exit code.

## Definition of Done

- [ ] References the standard DoD clauses in inherited-core.md.
