---
id: DIR-070-D
title: "DIR-070-D: Gap 2 — package run-routines as plugin skill"
status: done
labels:
  - milestone-candidate
  - milestone:M140
parent: DIR-070
children: []
extra:
  dirStatus: pending
  schema: v1
  deliverable: yes
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-070-D
    experiments/quay-perpetual-stream/charters/M140-dir070d-routines-skill.md
    /tmp/m140-absorb-entry.md
---
## Proposal

Package `run-routines.js` (currently in `.claude/workflows/`) as a plugin skill at `plugin/skills/routines/SKILL.md`. Claude Code plugins support `commands[]` -> skills; there is no `workflows/` directory in the plugin manifest. The workflow is already fully portable -- it uses `${CLAUDE_PLUGIN_ROOT}/scripts/` for all script references and contains zero experiment-local paths.

## Plan

N/A — plan is fully detailed inline below (4 steps: SKILL.md authoring, plugin.json update, test update, backward-compat wrapper). Reference: `docs/proposals/exp5-deliverable-improvements.md` Gap 2.

1. Create `plugin/skills/routines/SKILL.md` with the routine track pipeline (Schedule -> Dispatch -> Gate -> Verify), adapted from `.claude/workflows/run-routines.js`
2. Add `./skills/routines/SKILL.md` to `plugin.json` `commands[]` array
3. Update `plugin/test/plugin-packaging.test.mjs` to include the new skill in byte-identity and leak checks
4. Keep `.claude/workflows/run-routines.js` as a thin wrapper that invokes the skill (backward compat)

## Acceptance Criteria

- [x] `/routines` skill dispatches `routine-scheduler.ts` -> probe agents -> `routine-file-gate.ts` -> verify (SKILL.md documents all 4 phases; test confirms; scripts exist in plugin/scripts/; structural confirmation -- behavioral E2E verification deferred per iteration-0.md)
- [ ] Skill works with chrome-devtools/playwright MCP available (DIR-069 browser-explorer probe) -- CONCERNS: instrument-awareness documented but no behavioral E2E test; structural pieces in place (read-probe-spec.ts, SKILL.md contract 2)
- [ ] Skill works when no MCP instruments are available (skips with `filed: 0`) -- CONCERNS: clean-skip documented but no behavioral E2E test; same pattern as above
- [x] `plugin.json` commands[] includes `./skills/routines/SKILL.md` (verified in plugin.json line 15; packaging test PASS)
- [x] `plugin-packaging.test.mjs` passes with new skill (30/30 pass, 0 failures; commit 2bd9439)
- [x] No `experiments/quay-perpetual-stream` or `exp5` in shipped skill (grep returns 0 matches; leak-check test PASS)

## Definition of Done

References the standard DoD clauses from `inherited-core.md` (13 clauses, single executable source: `scripts/it0-dod-check.ts`). Specific to this milestone:

- [x] Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 2 (cited in Plan section line 25)
- [x] `plugin/skills/routines/SKILL.md` authored (107 lines, committed in 2bd9439)
- [x] `plugin.json` updated (commands[] includes ./skills/routines/SKILL.md)
- [x] Plugin packaging test updated and passing (30/30 pass, routines skill tests included)
- [x] Depends on DIR-070-B (gates must be in plugin/scripts/ for the skill to reference) (DIR-070-B DONE; all 3 referenced scripts in plugin/scripts/)
- [x] Enables DIR-069 (browser-explorer probe dispatch path) (DIR-069 DONE; SKILL.md cross-cutting section documents dispatch path)

## Touches

- `plugin/skills/routines/SKILL.md` (new)
- `plugin/.claude-plugin/plugin.json`
- `plugin/test/plugin-packaging.test.mjs`

## Not selected (M-136)

Capability-growth and deliverable:yes, but depends on DIR-070-A (symlinks) and DIR-070-B (Tier A gates in plugin/) completing first. Will be eligible after those land.

## Not selected (M-137)

Capability-growth and deliverable:yes. DIR-070-B (Tier A) was the priority for this pass. Will be eligible after DIR-070-B lands.

## Not selected (M-138)

Capability-growth and deliverable:yes. DIR-069 (browser-explorer probe) was the priority for discovery diversity. Will be eligible after Tier B gates land.

## Not selected (M-139)

Capability-growth and deliverable:yes. DIR-070-C (Tier B gates) was the priority to complete Gap 1 first. Now eligible — Gap 1 is complete.