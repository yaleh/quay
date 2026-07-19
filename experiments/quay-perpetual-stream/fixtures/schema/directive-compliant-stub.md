---
id: FIX-DIR-COMPLIANT
title: "Compliant directive task (marked, no Plan allowed, Resolution with evidence)"
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

Record the finding that the directive lifecycle should be task-canonical, folding Finding plus
Requested action behind a one-line context lead-in. This directive has NO `## Plan` section, which is
allowed for a directive by the label-aware A2 branch — proving a directive with no Plan does NOT fail
where a milestone-candidate would. Real approach text, comfortably past the placeholder floor.

## Acceptance Criteria

- [ ] A runnable grep/query check with an exit code confirms the directive is applied.

## Definition of Done

- [ ] References the standard DoD clauses in inherited-core.md; real-landing bar per DIR-026.

## Resolution

- outcome: applied
- evidence: landed in commit abc1234; the round-trip check renders PASS and the regenerated view
  reflects the change. Net diffstat verified subtractive at the authoring source. This is substantive
  evidence, not a bare status mirror, so assertion A5 passes.
