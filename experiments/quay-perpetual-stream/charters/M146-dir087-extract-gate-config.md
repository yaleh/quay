# M146 — Extract gate factory config to reduce fanOut

**Task:** DIR-087
**Milestone counter:** 146
**Chart:** 2
**Class:** methodology (instrument-correction)
**Value type:** instrument-correction
**Cadence:** exploit
**Deliverable:** no (internal refactoring)
**Charter tokens:** ~0.3 K
**type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (internal refactoring). Real value: cleaner architecture, lower fanOut.

## Scope

3 files:

1. `packages/quay/src/gate/config/` — new module with config types and functions
2. `packages/quay/src/gate/factories/` — extract config, keep factory logic
3. `packages/quay/src/gate/loader.ts` — update imports

## Touches
- packages/quay/src/gate/config/ (new)
- packages/quay/src/gate/factories/ (extract)
- packages/quay/src/gate/loader.ts (update imports)

## Done-when (binary)

1. Gate factory config extracted to config/ module.
2. All existing tests pass (gate.test.mjs + related).
3. fanOut reduced as verified by archguard.
4. No new cycles introduced.

## Inner termination

Done-when-complete OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
