# M149 — Ship distributable quay CLI + MCP loop-driver

**Task:** DIR-094
**Milestone counter:** 149
**Chart:** 2
**Class:** development (capability-growth)
**Value type:** capability-growth
**Cadence:** exploit
**Deliverable:** yes (distributable product)
**Charter tokens:** ~0.4 K
**type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (infrastructure). Real value: quay becomes usable outside its own workspace —
external workspaces (archguard, meta-cc) can run the loop driver via MCP tools.

## Scope

3 files:

1. `packages/quay/package.json` — add build step for distributable CLI
2. `packages/quay-native/package.json` — fix bin entry (compiled JS, not TS source)
3. `plugin/skills/loop-driver/SKILL.md` — switch from CLI commands to MCP tools

## Touches
- packages/quay/package.json
- packages/quay-native/package.json
- plugin/skills/loop-driver/SKILL.md

## Done-when (binary)

1. quay Core CLI distributable.
2. quay-native CLI uses compiled JS.
3. loop-driver skill uses MCP tools.
4. Cross-workspace verified on archguard.

## Inner termination

Done-when-complete OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
