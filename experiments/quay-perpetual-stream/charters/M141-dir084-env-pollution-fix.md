# M141 — Fix QUAY_ACCEPTANCE_CWD env pollution in MCP lifecycle handlers

**Task:** DIR-084
**Milestone counter:** 141
**Chart:** 2
**Class:** development (capability-growth — product bug fix)
**Value type:** capability-growth
**Cadence:** exploit
**Deliverable:** yes (product code shipped)
**Charter tokens:** ~0.4 K
**type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (small bug fix, no chart-2 surface cell moves).
Real value: MCP lifecycle handlers no longer permanently pollute QUAY_ACCEPTANCE_CWD,
preventing stale workspace-root cascades in long-running MCP servers.

## Scope

2 files, ~20 lines:

1. `packages/quay/src/mcp-handlers.ts` — add save/restore try/finally in
   `lifecycle_complete` and `lifecycle_promote`, matching `gate_run`'s existing pattern.
2. `packages/quay/test/mcp-server.test.mjs` — add env-var-unchanged assertion.

## Touches
- packages/quay/src/mcp-handlers.ts
- packages/quay/test/mcp-server.test.mjs

## Done-when (binary)

1. `lifecycle_complete` handler saves/restores QUAY_ACCEPTANCE_CWD using try/finally.
2. `lifecycle_promote` handler saves/restores QUAY_ACCEPTANCE_CWD using try/finally.
3. MCP server test asserts env var unchanged after lifecycle calls.
4. Existing MCP server test suite passes (no regressions).

## Inner termination

Done-when-complete OR ΔV<0.02 K=2 OR budget ~10 AND NOT climbing OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
