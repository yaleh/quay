---
id: FIX-FAIL-SCAFFOLD-DIRFILE
title: "A6 violation: frontmatter extra.dirFile scaffolding key"
status: done
labels:
  - directive
parent: null
children: []
extra:
  schema: "v1"
  dirStatus: applied
  dirFile: experiments/quay-perpetual-stream/directives/archive/DIR-XXX-some-directive.md
---
## Proposal

This fixture isolates the A6 dirFile scaffolding failure — the frontmatter `extra.dirFile` key is the
projection-scaffolding fingerprint (a task should not be a projection of a file). Detection reads the
PARSED frontmatter key, not a whole-file grep, so prose mentions of the word dirFile do not fire. It
must FAIL scaffolding-dirfile.

## Acceptance Criteria

- [ ] a runnable check with an exit code.

## Definition of Done

- [ ] References the standard DoD clauses in inherited-core.md.
