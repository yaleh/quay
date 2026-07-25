# M144 — Fix process.exitCode coupling in lifecycle.ts

**Task:** DIR-086
**Milestone counter:** 144
**Chart:** 2
**Class:** development (capability-growth — product bug fix)
**Value type:** capability-growth
**Cadence:** exploit
**Deliverable:** yes (product code shipped)
**Charter tokens:** ~0.3 K
**type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (small bug fix). Real value: MCP server no longer leaks stale
process.exitCode between lifecycle operations. Removes 4 global state mutations
from a library that should be pure.

## Scope

3 files, ~30 lines:

1. `packages/quay/src/gate/lifecycle.ts` — add `exitCode` to return types,
   deprecate `process.exitCode` assignments.
2. `packages/quay/src/mcp-handlers.ts` — reset `process.exitCode = 0` after
   lifecycle calls.
3. `packages/quay/test/mcp-server.test.mjs` — add exitCode assertion.

## Touches
- packages/quay/src/gate/lifecycle.ts
- packages/quay/src/mcp-handlers.ts
- packages/quay/test/mcp-server.test.mjs

## Done-when (binary)

1. lifecycle.ts functions no longer leave stale process.exitCode in MCP context.
2. MCP server test asserts exitCode is 0 after lifecycle operations.
3. Existing lifecycle and MCP server test suites pass.

## Inner termination

Done-when-complete OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
