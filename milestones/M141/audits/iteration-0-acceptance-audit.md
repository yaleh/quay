# M141 iteration-0 acceptance audit — DIR-084 (QUAY_ACCEPTANCE_CWD env pollution fix)

**Auditor:** machine (Clause 1 adversarial-audit subagent)
**Date:** 2026-07-25
**Task:** DIR-084
**Charter:** experiments/quay-perpetual-stream/charters/M141-dir084-env-pollution-fix.md
**Verdict:** REFUTED (mechanical gate — pre-existing infrastructure regression, NOT a DIR-084 defect)

---

## AC Satisfaction (refute-first)

### AC 1: `lifecycle_complete` MCP handler saves/restores `QUAY_ACCEPTANCE_CWD` using try/finally (matching `gate_run`)

**VERDICT: CONFIRMED**

Evidence: `/home/yale/work/quay/packages/quay/src/mcp-handlers.ts` lines 391-408.

```typescript
async ({ provider, id, file }) => {
  const prevCwd = process.env.QUAY_ACCEPTANCE_CWD;          // SAVE (line 392)
  try {
    const { client } = await getClient(provider);
    const logPath = resolveGateLogPath(cfg.workspaceRoot, { file });
    process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot;    // SET (line 396)
    const result = await runComplete({ ... });
    ...
  } catch (err) {
    return { isError: true, ... };
  } finally {
    if (prevCwd === undefined) delete process.env.QUAY_ACCEPTANCE_CWD;  // RESTORE (lines 405-406)
    else process.env.QUAY_ACCEPTANCE_CWD = prevCwd;
  }
}
```

This matches the existing `gate_run` save/restore pattern (lines 303-304, 331-333) exactly: save `prevCwd`, set env var inside try, restore inside finally (handles both defined/undefined prior states). No refutation found.

### AC 2: `lifecycle_promote` MCP handler saves/restores `QUAY_ACCEPTANCE_CWD` using try/finally

**VERDICT: CONFIRMED**

Evidence: `/home/yale/work/quay/packages/quay/src/mcp-handlers.ts` lines 457-474.

```typescript
async ({ provider, id, file }) => {
  const prevCwd = process.env.QUAY_ACCEPTANCE_CWD;          // SAVE (line 458)
  try {
    const { client } = await getClient(provider);
    const logPath = resolveGateLogPath(cfg.workspaceRoot, { file });
    process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot;    // SET (line 462)
    const result = await runPromote({ ... });
    ...
  } catch (err) {
    return { isError: true, ... };
  } finally {
    if (prevCwd === undefined) delete process.env.QUAY_ACCEPTANCE_CWD;  // RESTORE (lines 471-472)
    else process.env.QUAY_ACCEPTANCE_CWD = prevCwd;
  }
}
```

Same pattern. No refutation found.

### AC 3: MCP server test asserts env var unchanged after lifecycle calls

**VERDICT: CONFIRMED**

Evidence: `/home/yale/work/quay/packages/quay/test/mcp-server.test.mjs` lines 1572-1670 (DIR-084 block).

The test block:
1. Spawns `quay mcp` with `QUAY_ACCEPTANCE_CWD` pre-set to a distinct temp directory (`presetCwdDir`)
2. Creates ENV-CWD task whose acceptance command checks `pwd == presetCwdDir`
3. Calls `lifecycle_complete` on ENV-LC (ready, acceptance=true) — PASS
4. Runs `gate_run` (no explicit `cwd`) on ENV-CWD — assertion `ok:true` means `pwd == presetCwdDir`, proving the env var was restored — PASS
5. Calls `lifecycle_promote` on ENV-LP (todo, AC/DoD checked) — advances to ready — PASS
6. Runs `gate_run` (no explicit `cwd`) on ENV-CWD again — assertion `ok:true` proves env var was restored again — PASS

All 8 DIR-084 assertions pass (full test output lines PASS).

No refutation found.

### AC 4: Existing MCP server tests still pass

**VERDICT: CONFIRMED**

Evidence: Full test suite run (2026-07-25 08:52 UTC):

```
All QN-036 Core MCP server (DIR-007) tests passed.
packages/quay/test/mcp-server.test.mjs (43750.172583ms)
tests 1, pass 1, fail 0, cancelled 0, skipped 0, todo 0
```

Duration: ~43.7s. Zero regressions across blocks 1-19 (task_list, task_get, task_write, task_check, action_list, action_run, multi-Provider aggregation, GitHub cross-Provider, broken Provider, prefix filter, schema checks, search, pagination, multi-label, _version, pagination edge cases, inFence fix, gate/lifecycle MCP tools, DIR-084 env-var-unchanged). No refutation found.

---

## DoD Satisfaction

### DoD item: Code change in `packages/quay/src/mcp-handlers.ts`

**CONFIRMED** — save/restore try/finally added to `lifecycle_complete` (lines 392, 405-407) and `lifecycle_promote` (lines 458, 471-473).

### DoD item: Test added to `packages/quay/test/mcp-server.test.mjs`

**CONFIRMED** — DIR-084 test block at lines 1572-1670, with 8 assertions exercising env-var-restore after both lifecycle handlers.

### DoD item: Full MCP server test suite passes

**CONFIRMED** — exit code 0, 1 test file, 0 failures, ~43.7s.

---

## Mechanical Gate (it0-dod-check.sh)

**VERDICT: REFUTED** — exit code 2 (not 0).

```
ERROR: no backlog row found for milestone id '/tmp/it0-dod-check-backlog-998674-1784969551152.md' in backlog.md
ERROR: it0-impl-row-check.sh usage/environment error (exit 2): ERROR: no backlog row found for milestone id '...' in backlog.md
EXIT_CODE=2
```

**Root cause:** Pre-existing `it0-impl-row-check.sh` positional arg regression introduced by DIR-070-C Tier B gate parameterization (M139). The while-loop parser treats all non-flag positional args as MILESTONE_ID, overwriting the first with the temp file path. This is the SAME regression documented in dashboard.md deviation rows for M139 (line 455) and M140 (line 458). M141 has no row in `backlog.md` (grep count = 0), and the mechanical enforcer cannot process milestones without a backlog row.

**Impact on DIR-084:** Zero — the implementation is correct, all 4 AC and 3 DoD items are independently verified above. The mechanical gate failure is an infrastructure defect, not a DIR-084 defect. The fix code works correctly: save/restore is present in both handlers, tests confirm the env var is properly restored after each lifecycle call, and the full test suite passes with zero regressions.

---

## Deviation row

Added to dashboard.md "Homeostatic variables (DIR-017 Step 3)" table — see write-back below.
