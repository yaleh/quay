# M147 — Fix version consistency drift across 8 package files

**Task:** DIR-095
**Milestone counter:** 147
**Chart:** 2
**Class:** development (capability-growth)
**Value type:** capability-growth
**Cadence:** exploit
**Deliverable:** yes (consistent version in shipped packages)
**Charter tokens:** ~0.3 K
**type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (mechanical sync). Real value: version-consistency-check.test.ts passes,
session-start healthcheck is clean.

## Scope

8 version-bearing files, sync to v0.3.13:

packages/*/package.json, plugin/.claude-plugin/{plugin,marketplace}.json,
.claude-plugin/marketplace.json, plugin/vendor/quay/package.json

## Touches
- packages/*/package.json
- plugin/.claude-plugin/*.json
- .claude-plugin/marketplace.json
- plugin/vendor/quay/package.json

## Done-when (binary)

1. All 8 version-bearing files synced to consistent version.
2. `node --test scripts/version-consistency-check.test.ts` exits 0.
3. Session-start healthcheck no longer warns.

## Inner termination

Done-when-complete OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
