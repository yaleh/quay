# M140 — Package run-routines as plugin skill

**Task:** DIR-070-D
**Milestone counter:** 140
**Chart:** 2
**Class:** methodology (capability-growth — deliverable infrastructure)
**Value type:** capability-growth
**Cadence:** exploit
**Deliverable:** yes (plugin skill consumed outside loop)
**Charter tokens:** ~0.6 K
**type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (instrument — packages existing workflow as portable plugin skill).
Real value: external workspaces can invoke `/routines` to run the routine track
(scheduler → probe dispatch → gate → FILE-ONLY verify). Enables DIR-069
(browser-explorer probe) dispatch path end-to-end.

## Scope

4 files:

1. `plugin/skills/routines/SKILL.md` — new skill file adapting `.claude/workflows/run-routines.js`
   pipeline (Schedule → Dispatch → Gate → Verify)
2. `plugin/.claude-plugin/plugin.json` — add `./skills/routines/SKILL.md` to commands[]
3. `plugin/test/plugin-packaging.test.mjs` — add skill to byte-identity + leak checks
4. `.claude/workflows/run-routines.js` — thin wrapper for backward compat

## Touches
- plugin/skills/routines/SKILL.md (new)
- plugin/.claude-plugin/plugin.json
- plugin/test/plugin-packaging.test.mjs

## Done-when (binary)

1. `/routines` skill exists at `plugin/skills/routines/SKILL.md` with full pipeline description.
2. `plugin.json` commands[] includes the skill.
3. `plugin-packaging.test.mjs` passes with new skill (no experiment leakage).
4. Backward compat: `.claude/workflows/run-routines.js` still works as thin wrapper.
5. Browser-explorer probe dispatch path verified end-to-end (skill → scheduler → probe → gate).

## Inner termination

Done-when-complete OR ΔV<0.02 K=2 OR budget ~10 AND NOT climbing OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
