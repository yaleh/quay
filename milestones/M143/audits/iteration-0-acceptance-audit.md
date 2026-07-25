# Iteration-0 Acceptance Audit -- DIR-085 (M143): Add gate_list MCP tool

**Audit type:** adversarial-acceptance
**Task:** tasks/DIR-085.md
**Charter:** experiments/quay-perpetual-stream/charters/M143-dir085-gate-list-mcp.md
**Date:** 2026-07-25
**Audit session id:** audit-m143-fresh-20260725
**Orchestrator id:** independent (fresh dispatch, not inline)

## Verdict

**CONCERNS**

All 4 AC and 3 task-specific DoD items are confirmed by concrete artifact inspection and live test execution. The implementation is correct. However, the task lifecycle is incomplete (`status: needs-human`, not `done`) -- the ABSORB was blocked by an audit-independence-check gate failure in the prior bootstrap audit. The implementation code IS merged to master and passes all tests including the gate_list block, but the milestone was never successfully completed.

---

## Summary of findings

Each AC and DoD item was independently verified against concrete source/test output, NOT the implementer's self-report.

### AC #1: `gate_list` MCP tool is registered and callable

**Verdict: CONFIRMED.**

Evidence (fresh verification, 2026-07-25):
- Source: `packages/quay/src/mcp-handlers.ts`, lines 373-399 (`server.registerTool("gate_list", ...)`)
- `listGates` imported from `./gate/registry.ts` at line 18
- `registerGateHandlers` is called from `registerAllHandlers` at line 612
- `listGates` is exported from `packages/quay/src/gate/registry.ts` at line 126
- Live test (2026-07-25): `PASS: gate_list (default provider) returns no error (DIR-085)`
- Live test: `PASS: listTools() includes 'gate_list' tool (DIR-085)`

### AC #2: Returns an array of gate name strings including built-ins (dod, acceptance) and workspace gates

**Verdict: CONFIRMED.**

Evidence (fresh verification):
- Live test output (2026-07-25): `gate_list returns gates array (got: {"gates":["dod","acceptance","doc-quay-directive-skill"]})`
- `"dod"` and `"acceptance"` are built-in gates registered in `registry.ts`
- `"doc-quay-directive-skill"` is a workspace gate from `.quay/gates.yml`, confirming workspace gates are included
- Test assertions at L1699-1705 pass: `gates.includes("dod")` and `gates.includes("acceptance")`

### AC #3: MCP server test verifies the tool exists and returns expected gates

**Verdict: CONFIRMED.**

Evidence (fresh verification):
- Test block at `packages/quay/test/mcp-server.test.mjs`, lines 1672-1725
- Sub-test (a): `listTools()` includes `gate_list` -- PASS
- Sub-test (a): `gate_list` inputSchema includes `provider` param -- PASS
- Sub-test (b): `gate_list` default provider returns dod and acceptance -- PASS (2 assertions)
- Sub-test (c): `gate_list` with explicit `provider='native'` -- PASS
- Sub-test (d): `gate_list` with unknown provider returns `isError:true` -- PASS
- All 5 assertions in the gate_list block pass in live execution

### AC #4: Existing MCP server tests still pass (no regressions)

**Verdict: CONFIRMED.**

Evidence (fresh verification):
- Full suite: `node --test packages/quay/test/mcp-server.test.mjs` -- exit 0
- 1 test file, 1 pass, 0 fail, 0 skipped
- All 19 test blocks pass including the new gate_list (DIR-085) block
- No regression in any existing test block

---

### DoD #1: `gate_list` tool added to `registerGateHandlers`

**Verdict: CONFIRMED.**

Evidence: `packages/quay/src/mcp-handlers.ts`, lines 373-399. Handler imports `listGates` from `registry.ts` (line 18), registers tool with `provider` parameter (Zod `z.string().optional()`), calls `listGates(cfg.workspaceRoot)`, returns `{ gates }` in both `content` and `structuredContent`.

### DoD #2: Test added to `packages/quay/test/mcp-server.test.mjs`

**Verdict: CONFIRMED.**

Evidence: Lines 1672-1725. Test block `gate_list (DIR-085)` covers: tool registration, default provider call, explicit provider call, unknown-provider error path. Follows the same fixture and assertion pattern as all other tool tests.

### DoD #3: Full MCP server test suite passes

**Verdict: CONFIRMED.**

Evidence (fresh verification, 2026-07-25): `node --test packages/quay/test/mcp-server.test.mjs` -- exit 0, 1/1 pass, ~43s duration.

---

## Mechanical gate (it0-dod-check.sh)

**PASS (exit 0)** -- fresh run 2026-07-25. All applicable clauses satisfied:
- clause0 (AC/DoD present): PASS
- clause1 (adversarial-audit disposition): PASS
- clause2 (vmeta-lag): PASS
- clause3 (line-budget): PASS
- clause4 (impl-row): PASS (not design-only)
- clause5 (no-self-exemption): PASS
- clause6 (escrow-delta-v): N/A (not design-only)
- clause7 (test-floor): PASS (WAIVER present)
- clause8 (task-canonical): PASS
- clause10 (tree-hygiene): PASS
- clause11 (worktree-branch-hygiene): PASS
- clause12 (audit-independence): N/A (no `## Audit-independence check` section in absorb entry -- see concern below)

---

## Concerns

### CONCERN #1: Task lifecycle incomplete -- status is `needs-human`, not `done`

The task `DIR-085` has `status: needs-human` on master (confirmed by `quay task_get DIR-085`). The implementation code is merged to master, all tests pass, and all AC/DoD items are satisfied. However:

1. The ABSORB attempt recorded in `/tmp/m143-absorb-entry.md` shows an `audit-independence-check FAIL`: the prior bootstrap audit session ID (`audit-m143-inline-20260725`) was not found in the dispatch record file. Under DIR-034 anti-forgery rules, this is a HARD BLOCK.

2. The absorb entry lacks a proper `## Audit-independence check` section heading (the existing section heading is `## Audit-independence check (pre-existing entry)`), causing clause12 of `it0-dod-check.sh` to report N/A.

3. The task was never promoted through `todo -> ready -> done` because the ABSORB gate failed at audit-independence-check.

4. The prior audit file at `milestones/M143/audits/iteration-0-acceptance-audit.md` was written by the same session that failed the audit-independence check, meaning it was a self-audit.

This fresh audit is genuinely independent (separately dispatched, not inline) and confirms the implementation is correct. The lifecycle can be completed once the absorb-entry format issue is resolved and the audit-independence check is re-run with a properly recorded session ID.

### CONCERN #2: Absorb entry audit-independence section heading mismatch

The absorb entry at `/tmp/m143-absorb-entry.md` has `## Audit-independence check (pre-existing entry)` as its section heading, not `## Audit-independence check`. The `it0-dod-check.sh` clause12 parser looks for the exact heading `## Audit-independence check`, so it reports N/A. This is a format issue in the absorb entry template -- the outer loop should ensure the heading matches what the mechanical enforcer expects.

---

## Deviation-log write-back

See dashboard.md "Homeostatic variables (DIR-017 Step 3)" table for this audit's deviation row (M143).
