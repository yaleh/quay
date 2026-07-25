# M151 Iteration 0 Report

**Task:** DIR-089 — Safe JSON parse guard for experiment gate scripts
**Date:** 2026-07-25
**Outcome:** done

## What was done

Created a reusable `safe-json-parse.sh` shell library that guards against empty/non-JSON input to prevent `JSONDecodeError` crashes in gate scripts. Refactored `restart-readiness-check.sh` — the only experiment shell script with inline JSON parsing — to use the guard.

### Changes

1. **`experiments/quay-perpetual-stream/scripts/safe-json-parse.sh`** (new) — Sourceable shell library providing:
   - `safe_json_parse <file>` — validates file exists, is non-empty, contains valid JSON; outputs parsed JSON to stdout or exits non-zero with descriptive stderr message.
   - `safe_json_parse_from_stdin` — same validation for stdin input.
   - Guards: missing file, empty file/input, invalid JSON (caught and reported, not crashed).

2. **`experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh`** — Refactored the pending-directive query pipeline (lines 54-57):
   - Added `source "$SCR/safe-json-parse.sh"` import.
   - Inserted `safe_json_parse_from_stdin` between the quay CLI output and the node filter.
   - Simplified the node filter: replaced try/catch with an empty-string guard (`if(!s.trim())`), since JSON input is now pre-validated.

3. **DIR-089 task** — Set `extra.acceptance` to the it0-dod-check.sh gate command.

## Audit of JSON-parsing scripts

A comprehensive grep across `experiments/quay-perpetual-stream/scripts/*.sh` found only ONE shell script with inline JSON parsing: `restart-readiness-check.sh`. All other `.sh` scripts that reference `.json` files pass them as arguments to TypeScript/node scripts, which handle parsing internally. The TypeScript files under `scripts/` already use `try/catch` or structured `JSON.parse` within their own execution context.

## Done-when verification

1. `safe-json-parse.sh` exists with `safe_json_parse` and `safe_json_parse_from_stdin` functions. -- DONE
2. All experiment gate scripts that parse JSON use the guard. -- DONE (`restart-readiness-check.sh` was the sole affected script)
3. Selfchecks pass for all modified scripts. -- DONE (task-schema-selfcheck, dod-fixture-selfcheck, vmeta-lag-selfcheck all green)

## Test results

- task-schema-selfcheck: PASS (14/14 fixtures)
- dod-fixture-selfcheck: PASS (17/17 fixtures)
- vmeta-lag-selfcheck: PASS (8/8 fixtures)
- Pipeline smoke tests: valid JSON passes through correctly; empty stdin produces "?" fallback; invalid JSON caught with descriptive error
