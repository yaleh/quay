# M141 iteration-0 -- DIR-084 env pollution fix

**Date:** 2026-07-25
**Iteration:** 0
**Class:** development (capability-growth)

## Summary

Fixed `QUAY_ACCEPTANCE_CWD` env pollution in MCP lifecycle handlers (`lifecycle_complete` and `lifecycle_promote`). Both handlers were unconditionally setting `process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot` without saving/restoring the prior value, unlike `gate_run` which already had proper save/restore in a try/finally block.

## Changes

### `packages/quay/src/mcp-handlers.ts`

- **`lifecycle_complete` handler** (line 391): Added `prevCwd` save before the try block, and a `finally` block that restores the saved value (or deletes the env var if it was previously unset). Pattern matches `gate_run`'s existing save/restore (lines 303-304, 327-334).
- **`lifecycle_promote` handler** (line 453): Same fix -- added `prevCwd` save and `finally` restore.

### `packages/quay/test/mcp-server.test.mjs`

- **DIR-084 env-var-unchanged block**: Added a new test sub-block inside block 12 (gate/lifecycle MCP tools) that:
  1. Pre-sets `QUAY_ACCEPTANCE_CWD` to a distinct temp directory when spawning `quay mcp`
  2. Calls `lifecycle_complete` on a ready task (ENV-LC, acceptance=true)
  3. Verifies env var was restored by running `gate_run` (no explicit cwd) on a task (ENV-CWD) whose acceptance checks that `pwd` equals the pre-set temp dir
  4. Calls `lifecycle_promote` on a todo task (ENV-LP, AC/DoD checked)
  5. Verifies env var was restored again with the same mechanism

## Test results

Full MCP server test suite passes: 1/1 test file, 0 failures. New DIR-084 assertions all pass:

- `DIR-084 lifecycle_complete on ENV-LC returns no error` -- PASS
- `DIR-084 lifecycle_complete on ENV-LC (acceptance=true) returns ok:true` -- PASS
- `DIR-084 gate_run on ENV-CWD after lifecycle_complete returns no error` -- PASS
- `DIR-084 after lifecycle_complete, QUAY_ACCEPTANCE_CWD was restored: gate_run sees presetCwdDir` -- PASS
- `DIR-084 lifecycle_promote on ENV-LP returns no error` -- PASS
- `DIR-084 lifecycle_promote on ENV-LP (todo, AC/DoD checked) advances to ready` -- PASS
- `DIR-084 gate_run on ENV-CWD after lifecycle_promote returns no error` -- PASS
- `DIR-084 after lifecycle_promote, QUAY_ACCEPTANCE_CWD was restored: gate_run sees presetCwdDir` -- PASS

## Done-when verification

1. `lifecycle_complete` handler saves/restores QUAY_ACCEPTANCE_CWD using try/finally -- DONE
2. `lifecycle_promote` handler saves/restores QUAY_ACCEPTANCE_CWD using try/finally -- DONE
3. MCP server test asserts env var unchanged after lifecycle calls -- DONE
4. Existing MCP server test suite passes (no regressions) -- DONE
