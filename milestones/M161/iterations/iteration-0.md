# M161 iteration-0 report -- gap-gate-event-store-concurrency

**Milestone:** M161
**Task:** gap-gate-event-store-concurrency
**Class:** development (capability-growth)
**Chart:** 2
**Charter:** experiments/quay-perpetual-stream/charters/M161-gap-concurrency.md

## Changes

### 1. Single-writer constraint documented (`packages/quay/src/gate/gate-event-store.ts`)

Added a code comment to `appendGateEvent`'s JSDoc documenting the single-writer constraint. The comment:

- Describes the risk: concurrent `appendFileSync` calls from separate processes can interleave output lines, producing corrupted JSONL.
- Explains why this is not a live bug: all current callers (gate engine, gate-log resolver) are single-writer by construction -- there is no multi-process write path to the same `.quay/gate-events.jsonl` in normal operation.
- Points to the proven advisory-lock pattern in `packages/quay-native/src/store.ts` (`acquireLock`/`releaseLock`/`withLock`, lines 191-238) for future hardening if concurrent writes become a real risk, with concrete guidance on how to port it.

Per the charter (M161), this is a documentation-only change -- no locking was implemented. The charter explicitly prescribes the documentation path ("document the single-writer constraint with a code comment").

## Verification

- `node --test packages/quay/test/gate.test.mjs` -- all 25 tests pass, 0 failures
- No regressions in existing gate event store behavior

## Done-when checklist

The charter specifies one Done-when clause:

1. [x] Code comment documents single-writer constraint with pointer to native store lockfile pattern.
