# M143 Iteration 0 -- Build Report

**Milestone:** M143
**Task:** DIR-085
**Charter:** experiments/quay-perpetual-stream/charters/M143-dir085-gate-list-mcp.md
**Status:** Complete (all Done-when clauses satisfied)

## Summary

Added `gate_list` MCP tool to expose `listGates()` from the gate registry over MCP, closing the gap where MCP-connected agents could not discover registered gates.

## Changes

### `packages/quay/src/mcp-handlers.ts`
- Added `import { listGates } from "./gate/registry.ts";`
- Registered `gate_list` MCP tool in `registerGateHandlers()` (~30 lines):
  - Optional `provider` parameter (validates provider id, resolves workspaceRoot)
  - Calls existing `listGates(cfg.workspaceRoot)` -- zero new logic
  - Returns `{ gates: string[] }` including all built-in and workspace gates
  - Follows existing error-handling convention (`isError:true` on failure)

### `packages/quay/test/mcp-server.test.mjs`
- Added gate_list test block (DIR-085) within the existing gate test block:
  - (a) Verifies `gate_list` appears in `listTools()` output
  - (b) Verifies gate_list returns `dod` and `acceptance` built-ins via default provider
  - (c) Verifies gate_list works with explicit `provider` argument
  - (d) Verifies gate_list returns `isError:true` for unknown provider

## Test results

- `mcp-server.test.mjs`: All tests pass (including 4 new gate_list assertions)
- `gate.test.mjs`: All 25 tests pass (no regression)
- `cli.test.mjs`: All tests pass (no regression)
- CLI `quay gate --list`: Works correctly, returns full gate list

## Done-when verification

1. [x] `gate_list` MCP tool registered and callable via MCP
2. [x] Returns gate name array including built-ins (dod, acceptance, doc-quay-directive-skill) and workspace gates
3. [x] MCP server test verifies tool exists and returns expected gates
4. [x] Existing MCP server test suite passes (no regressions)
