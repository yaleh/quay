# M143 — Bundle workflows, agents, gate scripts into plugin

**Task:** DIR-081
**Milestone counter:** 143
**Chart:** 2
**Class:** development (capability-growth — shipped plugin code)
**Value type:** capability-growth
**Cadence:** exploit
**Deliverable:** yes (shipped plugin assets consumed by external workspaces)
**Charter tokens:** ~0.8 K
**type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (no chart-2 surface cell directly moves — this is distribution infrastructure).
Real value: external workspaces (archguard, meta-cc) can `quay:init` to receive workflows,
agent types, and gate scripts without manual copying from the quay repo.

## Scope

Seven phases per the proposal (`docs/proposals/quay-workflow-agent-distribution.md`):

1. `plugin/workflows/` — copy `.claude/workflows/{drain-directives,execute-milestone,run-routines}.js`
2. `plugin/agents/` — declare `baime:iteration-executor` agent type in `plugin.json` `agents[]`
3. `plugin/gate-scripts/` — copy it0-*.sh, vmeta-lag-check.sh, tree-hygiene-check.sh, etc.
4. `plugin/sync.sh` — keep plugin copies in sync with experiment sources
5. `plugin/skills/init/SKILL.md` — `quay:init` skill for idempotent, conflict-aware copy
6. `plugin/README.md` — document the distribution structure
7. Update `plugin-packaging.test.mjs` to cover new assets

## Touches
- plugin/workflows/
- plugin/agents/
- plugin/gate-scripts/
- plugin/sync.sh
- plugin/skills/init/SKILL.md
- plugin/.claude-plugin/plugin.json
- plugin/test/plugin-packaging.test.mjs

## Done-when (binary)

1. Three workflows copied to `plugin/workflows/`.
2. Agent type declared in plugin manifest.
3. Gate scripts copied to `plugin/gate-scripts/`.
4. `quay:init` skill created and registered.
5. `plugin-packaging.test.mjs` covers new assets.
6. No `exp5` or `experiments/quay-perpetual-stream` leaks in shipped files.

## Inner termination

Done-when-complete (6 clauses) OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
