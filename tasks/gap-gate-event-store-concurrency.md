---
title: "gate-event-store: appendGateEvent is not concurrency-safe"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    gap-gate-event-store-concurrency
    experiments/quay-perpetual-stream/charters/M161-gap-concurrency.md
    /tmp/m161-absorb-entry.md
---

## Finding

In `packages/quay/src/gate/gate-event-store.ts` lines 59-65, `appendGateEvent` uses `fs.appendFileSync(logPath, ...)` without any advisory locking or atomic-write guard. This differs from the native task store in `packages/quay-native/src/store.ts`, which uses an exclusive-create lockfile (`acquireLock`/`releaseLock`, lines 191-228) for every write operation.

**Evidence:** Compare `packages/quay/src/gate/gate-event-store.ts` line 64 (`appendFileSync(logPath, JSON.stringify(event) + "\n")`) with `packages/quay-native/src/store.ts` lines 191-228 (`acquireLock` using `fs.openSync(lockPath, "wx")`). The gate event store has zero concurrency protection. If two processes write to the same `gate-events.jsonl` simultaneously, their output lines can interleave, producing corrupted JSONL.

**Reproduction:** In theory, `quay gate <task1>` and `quay gate <task2>` on different tasks, run in parallel in separate terminals, both write to the same `.quay/gate-events.jsonl`. Without locking, interleaved writes are possible. In practice, `quay serve` could also trigger gate checks from concurrent HTTP request handlers.

## Proposal

Either add advisory file locking to `appendGateEvent` (using the proven `wx`-based lockfile pattern from `store.ts`), or document the single-writer constraint with a code comment acknowledging the limitation.

## Plan

1. Document the design decision: implement locking OR accept the single-writer constraint
2. If locking: port the acquireLock/releaseLock pattern from `packages/quay-native/src/store.ts` into `gate-event-store.ts`
3. Add a test verifying concurrent write safety if locking is implemented

## Acceptance Criteria

- [x] Decision documented in code: either locking implemented or single-writer constraint acknowledged
- [x] `node --test packages/quay/test/gate.test.mjs` passes (no regression)
- [x] If locking implemented: concurrency test passes — N/A: documentation path chosen per charter (M161), no locking implemented

## Definition of Done

Standard DoD: inherited-core.md clauses 0-12 (met via documentation-only path per charter M161; no product-touching surface changed, no locking implemented).

- [x] Code comment or lock implementation in `packages/quay/src/gate/gate-event-store.ts`
- [x] Existing gate tests pass
- [x] New test if locking implemented — N/A: documentation path chosen per charter, no locking implemented

## Touches
- packages/quay/src/gate/gate-event-store.ts
