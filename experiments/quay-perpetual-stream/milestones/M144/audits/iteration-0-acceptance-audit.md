# M144 iteration-0 acceptance audit — DIR-086

**Audit timestamp:** 2026-07-25
**Task:** DIR-086
**Charter:** experiments/quay-perpetual-stream/charters/M144-dir086-exitcode-coupling.md
**Audit stance:** adversarial (refute-first)

## Verdict: CONCERNS

Product code implementation satisfies all 3 AC and all 3 DoD items with concrete,
independently verified evidence. The mechanical gate (`it0-dod-check.sh`) exits 2
due to an absorb-entry file format mismatch — the `## Backlog row` first column is
`M144` but the gate script is invoked with milestone ID `DIR-086`. This is a
clerical issue in the absorb-entry template, not a product code defect.

## AC satisfaction

### AC 1: MCP lifecycle handlers reset process.exitCode = 0 after calling lifecycle functions

**VERDICT: CONFIRMED**

Evidence:
- `packages/quay/src/mcp-handlers.ts` line 427: `process.exitCode = 0; // DIR-086: reset stale exitCode from lifecycle function (MCP is long-running)` — after `runComplete`
- `packages/quay/src/mcp-handlers.ts` line 494: `process.exitCode = 0; // DIR-086: reset stale exitCode ...` — after `runPromote`
- `packages/quay/src/mcp-handlers.ts` line 531: `process.exitCode = 0; // DIR-086: reset stale exitCode ...` — after `runRetreat`
- `packages/quay/src/gate/lifecycle.ts`: Option B applied — all 4 `process.exitCode = 1` assignments retained with `@deprecated` comments (lines 128-131, 137-140, 196-199, 219-222), and `exitCode: number` field added to `LifecycleResult` (line 102), `PromoteResult` (line 113), and `RetreatResult` (line 113) interfaces
- All lifecycle functions return `exitCode: 1` on error paths and `exitCode: 0` on success paths

### AC 2: MCP server test verifies process.exitCode is 0 after lifecycle operations

**VERDICT: CONFIRMED**

Evidence:
- `packages/quay/test/mcp-server.test.mjs` lines 1572-1590: DIR-086 test block
  - (a) `lifecycle_complete` on GATE-FAIL returns `exitCode: 1` in structuredContent (line 1582)
  - (b) Subsequent `gate_log` call on GATE-FAIL succeeds (line 1587-1588) — proving MCP server is still alive and responsive, which would NOT be the case if `process.exitCode` had leaked a stale non-zero value in the server process
- Test output confirmed: "DIR-086 lifecycle_complete on GATE-FAIL returns exitCode:1 in structuredContent" — PASS
- Test output confirmed: "DIR-086 gate_log after failing lifecycle_complete succeeds — MCP server is still alive (exitCode was reset)" — PASS

### AC 3: Existing lifecycle and MCP server test suites pass

**VERDICT: CONFIRMED**

Evidence:
- `node --test packages/quay/test/lifecycle.test.mjs`: 27 pass, 0 fail (all 27 assertions including DIR-086 exitCode return values)
- `node --test packages/quay/test/mcp-server.test.mjs`: all assertions pass, including 5 DIR-086-specific assertions

## Definition of Done satisfaction

### DoD 1: Fix applied in lifecycle.ts and/or mcp-handlers.ts

**VERDICT: CONFIRMED**

Evidence:
- `packages/quay/src/gate/lifecycle.ts`: +exitCode fields to 3 interfaces (LifecycleResult, PromoteResult, RetreatResult), +deprecation comments at 4 error sites, exitCode returned on all paths
- `packages/quay/src/mcp-handlers.ts`: +process.exitCode = 0 resets at 3 handler sites (runComplete, runPromote, runRetreat)

### DoD 2: Test coverage for exitCode behavior in MCP context

**VERDICT: CONFIRMED**

Evidence:
- `packages/quay/test/mcp-server.test.mjs` lines 1572-1590: dedicated DIR-086 test block with 5 assertions covering exitCode in structuredContent and server liveness after failing lifecycle operations

### DoD 3: All existing tests pass

**VERDICT: CONFIRMED**

Evidence:
- Lifecycle tests: 27/27 pass
- MCP server tests: all sub-tests pass

## Mechanical gate

```
bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-086 \
  experiments/quay-perpetual-stream/charters/M144-dir086-exitcode-coupling.md \
  /tmp/m144-absorb-entry.md
EXIT CODE: 2
```

**Error:** `no backlog row found for milestone id 'DIR-086' in /tmp/it0-dod-check-backlog-...`

**Root cause:** The absorb-entry file `/tmp/m144-absorb-entry.md` has a `## Backlog row` section with `| M144 | DIR-086 | capability-growth | exitCode coupling fix | lifecycle.ts |` — the first column is `M144`, but the gate script is invoked with milestone ID `DIR-086`. The `it0-impl-row-check.sh` script's grep `^\| DIR-086 \|` does not match a line whose first column is `M144`. The real `backlog.md` uses `| DIR-086 |` as the first column for this task's row.

**This is NOT the M139 positional arg regression** (which is already fixed — the current `it0-impl-row-check.sh` correctly handles positional args). This is a distinct clerical issue: the absorb-entry template used `M144` as the first column instead of `DIR-086`.

## Deviation row

See dashboard.md line 466 (new row appended). One CONCERNS-level deviation:
- caught-by: machine, caught-at: M144, description: mechanical gate exit 2 due to absorb-entry `## Backlog row` first-column mismatch (`M144` vs `DIR-086`)
