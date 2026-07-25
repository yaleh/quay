---
id: exp5-M-ROUTINE-F-156-1
title: "quay-native: 3 test helper subprocess scripts crash when discovered
  directly by test runner"
status: done
role: primitive
labels:
  - defect
  - routine-finding
extra:
  schema: v1
  acceptance: "bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-ROUTINE-F-156-1 experiments/quay-perpetual-stream/charters/M159-routine-f-156-1-helper-crash.md /tmp/m159-absorb-entry.md"
---
## Finding

Three `.mjs` files in `packages/quay-native/test/` — `cas-writer-helper.mjs`, `concurrent-writer.mjs`, `reparent-writer.mjs` — are subprocess helper scripts that crash when the test runner discovers them directly. All three crash at `packages/quay-native/src/store.ts` line 126 (`fs.mkdirSync(tasksDir, ...)`) with `ERR_INVALID_ARG_TYPE` because `tasksDir` is `undefined` — the helpers destructure `process.argv` for args that are only present when spawned by parent tests. Reproduction: `node --test packages/quay-native/test/cas-writer-helper.mjs` → exit 1, `TypeError [ERR_INVALID_ARG_TYPE]`. Root cause: `cas-writer-helper.mjs` line 8 `const [, , tasksDir, id, mode] = process.argv;` — when run directly only `process.argv[0]` and `process.argv[1]` exist.

## Proposal

All three crash identically:

```
TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string
or an instance of Buffer or URL. Received undefined
    at Object.mkdirSync (node:fs:1652:5)
    at createStore (file:///.../packages/quay-native/src/store.ts:126:6)
```

- `cas-writer-helper.mjs` line 8: `const [, , tasksDir, id, mode] = process.argv;`
- `concurrent-writer.mjs` line 6: `const [, , tasksDir, id, label, runsArg] = process.argv;`
- `reparent-writer.mjs` line 9: `const [, , tasksDir, childId, newParentId] = process.argv;`

When run directly by `node --test`, only `process.argv[0]` (node path) and `process.argv[1]` (script path) exist. All destructured positional args are `undefined`.

## Impact

Running `node --test packages/quay-native/test/*.mjs` produces 3 failures (out of 46 tests total), masking real regressions and making CI/loop test runs unreliable.

## Acceptance Criteria

- [x] Running `node --test packages/quay-native/test/*.mjs` produces zero failures (all helper subprocess files are either guarded with an early-exit when args are missing, or excluded from test discovery via renaming/moving) — **audit M159: confirmed. 46/46 pass, 0 fail. All 3 helpers exit 0. Evidence: `node --test packages/quay-native/test/*.mjs` output.**
- [x] Parent tests (cas-write, lock, relation-sync) continue to spawn helpers correctly with their existing argument-passing patterns — **audit M159: confirmed. cas-write.test.mjs (all QN-015 tests passed), lock.test.mjs (all QN-006 tests passed), relation-sync.test.mjs (all M35 tests passed). All 3 include genuine concurrent-process spawn tests.**

## Definition of Done

Per inherited-core.md standard DoD clauses (0-12). This milestone's applicable clauses: 0 (AC+DoD checklist present), 1 (adversarial acceptance audit), 3 (line budget), 5 (no-self-exemption), 7 (test floor), 8 (canonical-lifecycle-record), 10 (tree-hygiene), 11 (worktree-branch-hygiene), 12 (audit-independence). Clauses 2 (V_meta consolidation), 4 (impl-row), 6 (escrow Δv), 9 (needs-human legitimacy) are N/A for this instrument-correction milestone.


- [x] `node --test packages/quay-native/test/*.mjs` exits 0 with 0 failures — **audit M159: confirmed. Exit code 0, 46 pass, 0 fail.**
- [x] No change to parent test behavior or helper subprocess contracts — **audit M159: confirmed. Parent spawn tests pass identically; arg-passing patterns unchanged; early-exit guards only activate when args are missing (direct discovery), not when args are provided (parent spawn).**


## Plan
N/A — no docs/plans/*.md reference (instrument-correction). Add early-exit guards to 3 test helper scripts so they don'''t crash when discovered directly by node --test.

## Acceptance Criteria
- [x] Running node --test packages/quay-native/test/*.mjs produces zero failures from helper subprocess scripts — **audit M159: confirmed. cas-writer-helper.mjs, concurrent-writer.mjs, reparent-writer.mjs all exit 0.**
- [x] Parent tests continue to spawn helpers correctly — **audit M159: confirmed. cas-write, lock, relation-sync tests all pass with concurrent-process spawn paths exercising genuine cross-process boundaries.**

## Definition of Done
Per inherited-core.md standard DoD clauses (0-12). Applicable: 0, 1, 3, 5, 7, 8, 10, 11, 12. Clauses 2/4/6/9 N/A.
- [x] 3 helper scripts guarded with early-exit when args missing — **audit M159: confirmed. cas-writer-helper.mjs line 11 (`process.argv.length < 5`), concurrent-writer.mjs line 9 (`process.argv.length < 6`), reparent-writer.mjs line 12 (`process.argv.length < 5`). All exit 0 with explanatory stderr message.**
- [x] Full test suite passes (node --test packages/quay-native/test/*.mjs exit 0) — **audit M159: confirmed. 46/46 pass, exit 0.**
- [x] Parent spawn tests unchanged — **audit M159: confirmed. All 3 parent tests pass with existing arg-passing patterns.**

## Touches
- packages/quay-native/test/cas-writer-helper.mjs
- packages/quay-native/test/concurrent-writer.mjs
- packages/quay-native/test/reparent-writer.mjs

## Execution record

**Milestone:** M159 · **Iterations:** 1 · **Realized Δv:** 0 · **Merge commit:** abdde88 · **Outcome summary:** Fixed 3 test helper subprocess scripts to exit cleanly (exit 0) when discovered directly by `node --test`, preventing crash failures that masked real regressions. All 46 tests pass.