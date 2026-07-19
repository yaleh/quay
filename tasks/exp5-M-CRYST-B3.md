---
id: exp5-M-CRYST-B3
title: "B3 [subtractive+root-cause] Fix authoring SOURCES: /quay-directive skill
  + OUTER-LOOP SELECT emit the schema; retire empty-Resolution template +
  dirStatus body-line dup"
status: done
labels:
  - milestone-candidate
  - crystallization
  - milestone:first-wave
parent: exp5-M-CRYST
children: []
extra:
  schema: "v1"
---
## Proposal
Fix the docs/skills that GENERATE tasks so they emit the B1 schema by construction: /quay-directive skill + OUTER-LOOP SELECT. Retire the vestigial empty ## Resolution template and the dirStatus body-line duplication (root causes of DIR-028's defects).
## Plan
N/A — implemented directly by editing the two authoring sources (`.claude/skills/quay-directive/SKILL.md`, `experiments/quay-perpetual-stream/OUTER-LOOP.md` SELECT); no staged docs/plans doc warranted.
## Acceptance Criteria
- [ ] A directive created via the rewritten skill, and a milestone task from SELECT, both conform to B2 with zero manual fixup.
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [ ] A REAL new directive (via the rewritten skill) round-trips schema-clean → PASS.
- [ ] A REAL milestone task (via SELECT) round-trips schema-clean → PASS.
- [ ] Both authoring sources emit `extra.schema:"v1"` + the schema by construction (no manual fixup).