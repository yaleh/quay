# M158 Iteration 0 — Gate-test coverage for gate-script-base.ts

**Task:** exp5-M-ROUTINE-F-156-3
**Charter:** experiments/quay-perpetual-stream/charters/M158-routine-f-156-3-gate-test.md
**Date:** 2026-07-25
**Outcome:** done

## Done-when verification

| # | Criterion | Result |
|---|-----------|--------|
| 1 | gate-script-base.test.mjs exists with tests for all exports | PASS — 41 tests covering 6 exported functions |
| 2 | loadbearing-test-gate.sh exits 0 | PASS — 9 pass, 26 N/A, 0 fail |
| 3 | adr-gate.test.mjs E3 A2 assertion passes | PASS |

## Coverage

```
gate-script-base.ts: 100% line, 95.83% branch, 100% functions
```

Exceeds the >=80% target.

## What was done

Created `experiments/quay-perpetual-stream/test/gate-script-base.test.mjs` with 41 unit tests covering all exported functions from `experiments/quay-perpetual-stream/scripts/gate-script-base.ts`:

| Export | Tests | Coverage |
|--------|-------|----------|
| `parseArgs` | 14 | positional args, string flags, boolean flags, `=` syntax, mixed types, minArgs, insufficient args exit, unrecognized flags, repeated flags |
| `readFrontmatter` | 10 | scalar fields, lists, empty list, null, empty values, no frontmatter, comments, blank lines, CRLF, missing file throws |
| `emitPass` | 2 | normal message, empty message |
| `emitFail` | 2 | normal message, empty message |
| `requireArg` | 8 | non-empty values (string, number, object), exit on undefined/null/empty, falsy-but-valid values (0, false) |
| `isDirectEntry` | 4 | matching entry, non-matching, empty argv1, relative path resolution |

Also set `extra.acceptance` on the task.

## Pre-Edit freshness check (M150 discipline)

Applied before the Edit on the task file.

## Files changed

- `experiments/quay-perpetual-stream/test/gate-script-base.test.mjs` (new)
- `tasks/exp5-M-ROUTINE-F-156-3.md` (extra.acceptance added)
