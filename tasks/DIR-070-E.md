---
id: DIR-070-E
title: "DIR-070-E: Gap 3 — extract quay-task-to-plan as plugin skill"
status: todo
labels:
  - milestone-candidate
  - human-steered
parent: DIR-070
children: []
extra:
  schema: v1
  deliverable: yes
  missionRedirection: true
---
## Proposal

Extract the reusable proposal→plan pipeline rules from `.claude/skills/quay-task-to-plan/` into `plugin/skills/quay-task-to-plan/SKILL.md`, leaving experiment-specific case studies in `.claude/skills/`. The subagent prompts (`adjudicate-proposal.md`, `plan-check-subagent.md`, `proposal-subagent.md`) and the structured workflow are workspace-portable — any quay consumer can use `## Proposal` → `## Plan` authoring.

## Plan

1. Read `.claude/skills/quay-task-to-plan/SKILL.md` and its prompts/ subdirectory
2. Extract the core pipeline rules (structure, phases, subagent dispatch) into `plugin/skills/quay-task-to-plan/SKILL.md`
3. Genericize any experiment-specific path references or section numbering
4. Leave experiment-specific case studies and V-meta references in `.claude/skills/`
5. Add `./skills/quay-task-to-plan/SKILL.md` to `plugin.json` commands[]
6. Update `plugin-packaging.test.mjs` for new skill

## Acceptance Criteria

- [ ] `/quay-task-to-plan` skill works in any quay workspace (not just this repo)
- [ ] Skill content passes leak test (no `experiments/quay-perpetual-stream` or `exp5`)
- [ ] Original `.claude/skills/quay-task-to-plan/` still works for exp5 loop
- [ ] `plugin.json` commands[] includes new skill
- [ ] `plugin-packaging.test.mjs` passes

## Definition of Done

- [ ] Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 3
- [ ] `plugin/skills/quay-task-to-plan/SKILL.md` authored
- [ ] `plugin.json` updated
- [ ] Plugin packaging test passes
- [ ] Human-steered: touches `.claude/skills/` (driver-self-rewrite per DIR-062 clause 1)

## Touches

- `.claude/skills/quay-task-to-plan/` (extract, not delete)
- `plugin/skills/quay-task-to-plan/SKILL.md` (new)
- `plugin/.claude-plugin/plugin.json`
- `plugin/test/plugin-packaging.test.mjs`
