# M143 — Add gate_list MCP tool

**Task:** DIR-085
**Milestone counter:** 143
**Chart:** 2
**Class:** development (capability-growth — new MCP API surface)
**Value type:** capability-growth
**Cadence:** exploit
**Deliverable:** yes (MCP tool in shipped product)
**Charter tokens:** ~0.3 K
**type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (small API addition). Real value: MCP-connected agents can discover
available gates without hardcoding names — closes a standing abstraction gap.

## Scope

2 files, ~25 lines:

1. `packages/quay/src/mcp-handlers.ts` — add `gate_list` tool to `registerGateHandlers`,
   calling existing `listGates()` with optional `provider` parameter.
2. `packages/quay/test/mcp-server.test.mjs` — add test asserting tool returns built-in
   gates (dod, acceptance).

## Touches
- packages/quay/src/mcp-handlers.ts
- packages/quay/test/mcp-server.test.mjs

## Done-when (binary)

1. `gate_list` MCP tool registered and callable via MCP.
2. Returns gate name array including built-ins (dod, acceptance) and workspace gates.
3. MCP server test verifies tool exists and returns expected gates.
4. Existing MCP server test suite passes (no regressions).

## Inner termination

Done-when-complete OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
