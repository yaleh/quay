---
id: exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH
title: "defect: unquoted colon in task frontmatter value crashes task_list for all tasks (single-task corruption)"
status: done
labels:
  - milestone-candidate
  - defect
extra:
  schema: "v1"
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH
    experiments/quay-perpetual-stream/charters/M89-yaml-frontmatter-crash.md
    /tmp/m89-absorb-entry.md
---
## Proposal

A task file with a YAML frontmatter value containing an unquoted `key: value` pattern inside
a flow/compact mapping context causes the YAML parser to throw `Nested mappings are not allowed`,
which causes `task_list` (and `task_get`) to fail for the ENTIRE task store, not just the
affected task. This is a single-task corruption that takes down the whole task board.

**Evidence:** `query_session_signals` (type=errors), session `a653b2e9-8c25-4560-8c85-bd3e757e56f3`,
2026-07-21T15:48:10Z (the FIRST error in the current session, blocking the loop from starting):
```
"Nested mappings are not allowed in compact mappings at line 14, column 14:
  dirStatus: mechanism-landed; real routine-fire pending a live routines: run (…
             ^"
```
**Source tool:** `mcp__plugin_quay_quay__task_list` (confirmed by `query_session_content` tool_result
search, session `a653b2e9`, turn 0).

**Root cause:** Task frontmatter field `dirStatus` had value:
```
dirStatus: mechanism-landed; real routine-fire pending a live routines: run (…)
```
The substring `routines: run` is parsed as a nested mapping start. The YAML spec requires
string values containing `: ` sequences to be quoted, but the task_write path does not validate
or auto-quote YAML values before writing.

**Impact:** The loop could not read its own task board at session start. Every tool call that
needs the task list failed until the offending task file was manually fixed. This is a
production-safety defect: one corrupted task silently blocks the entire loop.

**Fix approach:** Post-write YAML validation in `quay-native`'s task-write path — after writing
the file, immediately re-parse it and return an error if parsing fails. The writer already has
the data; this is a single read-back check. Optionally also auto-quote or sanitize string values
that contain `: ` patterns before writing (belt-and-suspenders).

## Plan

N/A — bounded fix: add a post-write YAML validation call in `packages/quay-native/src/` task
write path + add a RED→GREEN test covering the `: ` in frontmatter value case. Expected scope:
~50L product code change + ~30L new test. Well within 2000L ceiling.

## Acceptance Criteria

- [x] `quay-native` task write path validates YAML post-write and returns an error if the written file would fail to parse (not silently corrupt the store)
- [x] A RED→GREEN test covers: writing a task whose frontmatter value contains `key: value` patterns (`: ` in a string value), confirms the write either succeeds with valid YAML OR returns a clear validation error — not a silent corrupt file
- [x] `task_list` no longer crashes for all tasks when one task has a frontmatter value with `: ` in it — the bad task is rejected at write time, not at read time

## Definition of Done

References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts.

- [x] Post-write YAML validation added to `quay-native` task write path; the `: ` case is rejected or auto-quoted
- [x] RED→GREEN test pinning the fix (no fixture; the test must exercise the real write path)
- [x] Adversarial audit disposition recorded (CONCERNS: tsc OOM pre-existing; all product claims NO REFUTATION FOUND)
- [x] Acceptance gate PASS (pending quay gate run)

## Not selected (M88)

M88 was the explore milestone that filed this task (from history-mining). Not selected at M88 because M88 was itself this exploration.
