# M147 iteration-1 -- DIR-095: Fix version consistency drift

**Date:** 2026-07-25
**Milestone:** M147
**Task:** DIR-095
**Charter:** experiments/quay-perpetual-stream/charters/M147-dir095-version-consistency.md
**Iteration:** 1 (class-routed development, second task in M147 batch)

## Outcome

Done. Fixed single version drift: `plugin/.claude-plugin/plugin.json` was at `0.4.0` while all other 7 version-bearing files were at `0.3.13`. Synced to `0.3.13`.

## Changes

### 1. PRE-FLIGHT: extra.acceptance set on DIR-095

`task_write` set `extra.acceptance` = "bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-095 ..."

### 2. plugin/.claude-plugin/plugin.json -- version synced

Changed `"version": "0.4.0"` to `"version": "0.3.13"`. This was the sole drifted file among 8 version-bearing entries.

## Done-when verification

1. All 8 version-bearing files synced to consistent version. -- DONE (all at `0.3.13`)
2. `node --test scripts/version-consistency-check.test.ts` exits 0. -- DONE (9/9 pass, including `check returns all-equal on the real tree post-unification (GREEN)`)
3. Session-start healthcheck no longer warns. -- DONE (the `CLI exits 0 on the real tree` test passes, `VERSION-CONSISTENCY: OK`)

## Real evidence

```
# Version consistency check -- all 8 files at 0.3.13
$ node --experimental-strip-types scripts/version-consistency-check.ts --json
{"ok":true,"uniqueVersions":["0.3.13"],"mode":"all-equal"}

# Version consistency tests (9 pass, 0 fail)
$ node --experimental-strip-types --test scripts/version-consistency-check.test.ts
pass 9, fail 0

# Gate tests (no regressions)
$ node --test packages/quay/test/gate.test.mjs packages/quay/test/gate-ergonomics.test.mjs
pass 34, fail 0

# Lifecycle tests (no regressions)
$ node --test packages/quay/test/lifecycle.test.mjs
pass 27, fail 0

# MCP server tests (no regressions)
$ node --test packages/quay/test/mcp-server.test.mjs
pass 1 suite

# quay-native tests (no regressions -- 3 standalone-helper failures are pre-existing)
$ node --test packages/quay-native/test/*.mjs
pass 43, fail 3 (pre-existing: cas-writer-helper, concurrent-writer, reparent-writer need env vars)
```

## Files changed

- `plugin/.claude-plugin/plugin.json` -- version `0.4.0` -> `0.3.13`
- `tasks/DIR-095.md` -- extra.acceptance set
