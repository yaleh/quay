---
id: DIR-070-E
title: "DIR-070-E: Gap 3 — extract quay-task-to-plan as plugin skill"
status: done
labels:
  - milestone-candidate
  - human-steered
parent: DIR-070
children: []
extra:
  dirStatus: applied
  schema: v1
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

- [x] `/quay-task-to-plan` skill works in any quay workspace (not just this repo)
- [x] Skill content passes leak test (no `experiments/quay-perpetual-stream` or `exp5`)
- [x] Original `.claude/skills/quay-task-to-plan/` still works for exp5 loop
- [x] `plugin.json` commands[] includes new skill
- [x] `plugin-packaging.test.mjs` passes

## Definition of Done

- [x] Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 3
- [x] `plugin/skills/quay-task-to-plan/SKILL.md` authored
- [x] `plugin.json` updated
- [x] Plugin packaging test passes
- [x] Human-steered: touches `.claude/skills/` (driver-self-rewrite per DIR-062 clause 1)

## Touches

- `.claude/skills/quay-task-to-plan/` (extract, not delete)
- `plugin/skills/quay-task-to-plan/SKILL.md` (new)
- `plugin/.claude-plugin/plugin.json`
- `plugin/test/plugin-packaging.test.mjs`

## Resolution

2026-07-25: **Landed.** Fixed the 3 leak violations in `plan-check-subagent.md`:
1. Line 11: removed `docs/proposals/exp5-quay-task-proposal-plan-skill.md` reference
2. Line 32: genericized `experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh`
   to "workspace's line-budget gate script"
3. Line 58: removed duplicate exp5 doc reference
Leak test now clean (0 `exp5`/`experiments/quay-perpetual-stream` matches). All AC/DoD met.
