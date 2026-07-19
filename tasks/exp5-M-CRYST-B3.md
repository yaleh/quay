---
id: exp5-M-CRYST-B3
title: "B3 [subtractive+root-cause] Fix authoring SOURCES: /quay-directive skill
  + OUTER-LOOP SELECT emit the schema; retire empty-Resolution template +
  dirStatus body-line dup"
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-CRYST
children: []
extra: {}
---
## Proposal
Fix the docs/skills that GENERATE tasks so they emit the B1 schema by construction: /quay-directive skill + OUTER-LOOP SELECT. Retire the vestigial empty ## Resolution template and the dirStatus body-line duplication (root causes of DIR-028's defects).
## Acceptance Criteria
- [ ] A directive created via the rewritten skill, and a milestone task from SELECT, both conform to B2 with zero manual fixup.
## Definition of Done
Real: a REAL new directive + a REAL SELECT both round-trip schema-clean.