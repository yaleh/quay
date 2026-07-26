---
id: DIR-070-F
title: "DIR-070-F: Gap 3 — extract methodology skills (lower priority)"
status: todo
labels:
  - milestone-candidate
  - human-steered
parent: DIR-070
children: []
extra:
  dirStatus: deferred
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-070-F
    experiments/quay-perpetual-stream/charters/M179-dir070f-methodology-skills.md
    /tmp/m179-absorb-entry.md
---
## Proposal

Extract reusable methodology patterns from the remaining three `.claude/skills/` into plugin skills. Lower priority than DIR-070-E — these are reference material, not operational pipelines.

## Plan

### quay-native-methodology
- Extract: gate mechanics reference (`reference/gate-mechanics.md`), directive lifecycle (`reference/directive-lifecycle.md`), patterns (`reference/patterns.md`), G3 audit discipline (`reference/g3-audit-discipline.md`)
- Leave: experiment-specific case studies, inventory data, V-meta analysis

### quay-webui-bootstrap-methodology
- Extract: visual review mechanism rules (`reference/visual-review-mechanism.md`), effectiveness-timing corpus
- Leave: experiment-specific V-meta ceiling analysis, G3 env gap case study

### quay-core-bootstrap-methodology
- Lowest priority — mostly experiment history. Extract nothing; leave as experiment-local reference.

### Update manifests
Add extracted skills to `plugin.json` commands[] and `plugin-packaging.test.mjs`.

## Acceptance Criteria

- [x] Extracted skills pass leak test (no `experiments/quay-perpetual-stream` or `exp5`)
- [x] Original `.claude/skills/` still contain experiment-specific context
- [x] `plugin.json` commands[] updated
- [x] `plugin-packaging.test.mjs` passes

## Definition of Done

- [x] Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 3
- [x] Extracted methodology skills in `plugin/skills/`
- [x] `plugin.json` updated
- [x] Plugin packaging test passes
- [x] Human-steered: touches `.claude/skills/` (driver-self-rewrite per DIR-062 clause 1) — read-only touch: confirmed by dedicated regression test that originals are unmodified

## Touches

- `.claude/skills/quay-native-methodology/` (extract, not delete)
- `.claude/skills/quay-webui-bootstrap-methodology/` (extract, not delete)
- `plugin/skills/quay-native-methodology/SKILL.md` (new)
- `plugin/skills/quay-webui-bootstrap-methodology/SKILL.md` (new)
- `plugin/.claude-plugin/plugin.json`
- `plugin/test/plugin-packaging.test.mjs`
