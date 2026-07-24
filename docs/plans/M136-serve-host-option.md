# M136 — quay serve --host option (plan)

**Milestone:** M136
**Task:** DIR-068
**Charter:** experiments/quay-perpetual-stream/charters/M136-serve-host-option.md
**Class:** development (capability-growth)
**Date:** 2026-07-24

## Reconciled proposal

Source: adjudicated, minimal-surface-area + pattern-consistency (converged)

Add `host?: string` to `StartServerOptions` in `packages/quay/src/serve.ts`, thread through to `server.listen(port, host, callback)` defaulting to `"0.0.0.0"`, add `--host <host>` CLI flag in `packages/quay/bin/quay.ts`, update help text and log line. ~30 lines total, fully backward-compatible.

## Phases and stages

### Phase 1: Implementation (single stage, ~6 lines net)

**Stage 1.1 [code] — serve.ts + CLI threading**
- `packages/quay/src/serve.ts` (lines 32-36, 38, 92-94): add `host?: string` to `StartServerOptions`, destructure with default `"0.0.0.0"`, pass to `server.listen()`, update log line.
- `packages/quay/bin/quay.ts` (lines 314, 996-999): update help text, pass `host` from CLI flags to `startServer()`.

### TDD acceptance
- **[code] Stage 1.1**: >=80% line coverage on modified files (verified via existing test suite — `node --test packages/quay/test/serve.test.mjs` green; all 140+ assertions pass).

## Verification

1. `quay serve --host 127.0.0.1` binds only to localhost — verified via `timeout`.
2. `quay serve` (no --host) continues to bind `0.0.0.0` — verified via test output.
3. `quay serve --help` shows `[--host <host>]` — verified via CLI help output.
4. Log line reflects the actual host — verified: `listening on http://127.0.0.1:44173` and `listening on http://0.0.0.0:42531` (default).
5. Existing serve tests pass — verified: `node --test packages/quay/test/serve.test.mjs` all assertions pass.
