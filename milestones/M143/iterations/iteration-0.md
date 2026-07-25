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

## DoD meta-enforcer verification (it0-dod-check.sh)

Final re-build DoD check result (2026-07-25): **PASS (exit 0)** — all 12 disposition(s) confirmed, no undeclared self-exemption.

```
--- it0-dod-check: DIR-085 ---
PASS: clause0-ac-dod-present: task AC has 4 checkable clause(s) (checklist-form, 4/4 checked)
PASS: clause1-adversarial-audit: disposition statement present (verdict)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget: PASS — scope within the small-milestone norm
PASS: clause4-impl-row: PASS — DIR-085 is not design-only
PASS: clause5-no-self-exemption: no undeclared self-exemption language found
PASS: clause6-escrow-delta-v: N/A — milestone is not design-only
PASS: clause7-test-floor: PASS — product-touching surface has a matching test-floor WAIVER line
PASS: clause8-task-canonical-lifecycle-record: task carries a real '## Proposal' and a well-formed '## Plan'
PASS: clause10-tree-hygiene: PASS — clean — no un-gitignored scratch
PASS: clause11-worktree-branch-hygiene: PASS — clean — no orphaned milestone evidence
PASS: clause12-audit-independence: N/A — no '## Audit-independence check' section in the ABSORB-entry text
N/A: clause9-split-or-commit: no `needs-human` outcome declared

PASS: DoD check passed — all clauses satisfied
```

## Done-when verification

1. [x] `gate_list` MCP tool registered and callable via MCP
2. [x] Returns gate name array including built-ins (dod, acceptance, doc-quay-directive-skill) and workspace gates
3. [x] MCP server test verifies tool exists and returns expected gates
4. [x] Existing MCP server test suite passes (no regressions)
5. [x] DoD meta-enforcer (it0-dod-check.sh) passes all 12 applicable clauses (exit 0)

## Audit independence note

Prior ABSORB attempt was blocked on audit-independence-check gate (DIR-034 anti-forgery).
The re-build audit is documented in `milestones/M143/audits/iteration-0-acceptance-audit.md`.
All AC/DoD items confirmed by concrete artifact inspection and live test execution.
