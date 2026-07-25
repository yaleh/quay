---
id: DIR-070-D
title: "DIR-070-D: Gap 2 — package run-routines as plugin skill"
status: todo
labels:
  - milestone-candidate
parent: DIR-070
children: []
extra:
  dirStatus: pending
  schema: v1
  deliverable: yes
---
## Proposal

Package `run-routines.js` (currently in `.claude/workflows/`) as a plugin skill at `plugin/skills/routines/SKILL.md`. Claude Code plugins support `commands[]` → skills; there is no `workflows/` directory in the plugin manifest. The workflow is already fully portable — it uses `${CLAUDE_PLUGIN_ROOT}/scripts/` for all script references and contains zero experiment-local paths.

## Plan

1. Create `plugin/skills/routines/SKILL.md` with the routine track pipeline (Schedule → Dispatch → Gate → Verify), adapted from `.claude/workflows/run-routines.js`
2. Add `./skills/routines/SKILL.md` to `plugin.json` `commands[]` array
3. Update `plugin/test/plugin-packaging.test.mjs` to include the new skill in byte-identity and leak checks
4. Keep `.claude/workflows/run-routines.js` as a thin wrapper that invokes the skill (backward compat)

## Acceptance Criteria

- [ ] `/routines` skill dispatches `routine-scheduler.ts` → probe agents → `routine-file-gate.ts` → verify
- [ ] Skill works with chrome-devtools/playwright MCP available (DIR-069 browser-explorer probe)
- [ ] Skill works when no MCP instruments are available (skips with `filed: 0`)
- [ ] `plugin.json` commands[] includes `./skills/routines/SKILL.md`
- [ ] `plugin-packaging.test.mjs` passes with new skill
- [ ] No `experiments/quay-perpetual-stream` or `exp5` in shipped skill

## Definition of Done

- [ ] Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 2
- [ ] `plugin/skills/routines/SKILL.md` authored
- [ ] `plugin.json` updated
- [ ] Plugin packaging test updated and passing
- [ ] Depends on DIR-070-B (gates must be in plugin/scripts/ for the skill to reference)
- [ ] Enables DIR-069 (browser-explorer probe dispatch path)

## Touches

- `plugin/skills/routines/SKILL.md` (new)
- `plugin/.claude-plugin/plugin.json`
- `plugin/test/plugin-packaging.test.mjs`
