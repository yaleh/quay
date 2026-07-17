# Simulated User Audit — Iteration 12
**Persona**: CLI scripting/automation user
**Date**: 2026-07-17
**Verdict**: PASS

## QX-045 (CB-020 — JSON path clean): VERIFIED

- `--json` valid JSON: YES (87554 bytes, `JSON.parse()` succeeds cleanly)
- `--format json` valid JSON: N/A — `--format json` is not a supported flag; only `--json` exists. `--format json` silently falls through to the human-readable path and outputs `# filtered:` header + tab-separated lines. This is acceptable behaviour (unknown flags are ignored, not an error), but a user who guesses `--format json` from muscle memory will get non-JSON output with no error message. See gaps below.
- With `--label` filter + `--json`: YES (`--prefix QX --label experiment-4 --json` returns 35 tasks as valid JSON)
- Section 22 test (QX-045, CB-020): PASS — all three sub-cases pass:
  - (a) `--prefix QX --json` → valid JSON array, no `# filtered:` comment
  - (b) `--json` (no prefix) → valid JSON array
  - (c) `--prefix QX` (no `--json`) → includes `# filtered: QX-* (N tasks)` header as expected
- Non-JSON comment header: PRESENT (expected) — `# filtered: QX-* (46 tasks)` appears as first line of human-readable output; this is correct and unchanged

## New gaps found

1. **`--format json` not supported, no error surfaced** — `--format json` is a common idiom in CLI tools (e.g. `gh`, `kubectl`). Currently passing `--format json` is silently ignored and the user gets human-readable output. A user relying on this in a CI script would get no error code and corrupt pipeline data. Suggested fix: either support `--format <format>` as an alias for `--json`, or emit an error when `--format` is passed an unrecognised value.

2. **stderr leaks into scripts when not redirected** — `quay-native mcp: serving tasks from <path>` is emitted to stderr. Scripts that do `2>&1` to capture all output will get this line mixed into JSON, breaking parsers. The audit steps above used `2>/dev/null` to work around it. This is pre-existing behaviour, not a regression from QX-045, but it is a persistent friction point for CI use.

3. **`--json` on `task list` returns full task body fields** — for large task lists the JSON payload is large (87 KB for 46 tasks). There is no `--fields` or sparse-output option. This is a nice-to-have, not a blocker.

## Overall verdict: PASS

QX-045 / CB-020 is correctly implemented: the `--json` path emits valid JSON with no comment prefix, the non-JSON path preserves the human-readable `# filtered:` header, and the regression test (section 22) covers all three sub-cases and passes. The two gaps noted above (`--format json` silently ignored; stderr noise) are pre-existing issues unrelated to this iteration's change.
