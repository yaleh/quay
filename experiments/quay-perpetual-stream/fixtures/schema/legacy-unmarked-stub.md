---
id: FIX-LEGACY-UNMARKED
title: "Legacy task with no schema marker"
status: done
labels:
  - directive
parent: null
children: []
extra:
  dirStatus: applied
---
## Finding

A pre-existing legacy task authored before the extra.schema:"v1" marker existed. It has NO
frontmatter marker, so the schema check reports it as N/A-legacy (grandfathered) and never evaluates
the six assertions. This proves the forward-only boundary: unmarked legacy tasks are explicitly
N/A-reported, never silently skipped and never hard-failed.

## Requested action

None — this fixture only exercises the grandfather boundary (verdict must be N/A-legacy, exit 0).
