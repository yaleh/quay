# M144 iteration-0 — DIR-086: process.exitCode coupling fix

**Task:** `DIR-086`
**Charter:** `experiments/quay-perpetual-stream/charters/M144-dir086-exitcode-coupling.md`
**Class:** development (capability-growth — product bug fix).

## What was done

1. `packages/quay/src/gate/lifecycle.ts` — added `exitCode: number` to `LifecycleResult`, `PromoteResult`, and `RetreatResult` interfaces. All four lifecycle functions now return `exitCode: 1` on error paths and `exitCode: 0` on success paths. The existing `process.exitCode = 1` assignments are retained with `@deprecated` comments for CLI backward-compat.
2. `packages/quay/src/mcp-handlers.ts` — `registerLifecycleHandlers` now resets `process.exitCode = 0` after calling `runComplete`, `runPromote`, and `runRetreat`, preventing stale exit codes from leaking between calls in the long-running MCP server process.
3. `packages/quay/test/mcp-server.test.mjs` — added DIR-086 test block: verifies `lifecycle_complete` on a failing task returns `exitCode:1` in structuredContent, and that a subsequent `gate_log` call succeeds, proving the MCP server is still alive (exitCode was properly reset by the handler).

## Real evidence

```
# Lifecycle tests (Phase A + Phase C CLI)
$ node --test packages/quay/test/lifecycle.test.mjs
pass 27, fail 0

# MCP server tests including new DIR-086 exitCode assertions
$ node --test packages/quay/test/mcp-server.test.mjs
...
PASS: DIR-086 lifecycle_complete on GATE-FAIL returns ok:false
PASS: DIR-086 lifecycle_complete on GATE-FAIL returns exitCode:1 in structuredContent
PASS: DIR-086 gate_log after failing lifecycle_complete succeeds — MCP server is still alive (exitCode was reset)

# Gate test suite (no regressions)
$ node --test packages/quay/test/gate.test.mjs packages/quay/test/gate-ergonomics.test.mjs
pass 34, fail 0
```

## Touches

- `packages/quay/src/gate/lifecycle.ts` — +exitCode fields, +deprecation comments (4 locations)
- `packages/quay/src/mcp-handlers.ts` — +process.exitCode = 0 resets (3 locations)
- `packages/quay/test/mcp-server.test.mjs` — +DIR-086 exitCode test block
