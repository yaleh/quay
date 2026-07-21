---
id: exp5-DEFECT-YAML-FRONTMATTER-COLON-CRASH
title: "defect: unquoted colon in task frontmatter value crashes task_list for all tasks (single-task corruption)"
status: todo
labels:
  - milestone-candidate
  - defect
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
needs the task list failed until the offending task file was manually fixed.

## Plan

N/A — two options (either or both): (a) `task_write` validates YAML after writing and rejects
malformed frontmatter, (b) the frontmatter parser uses lenient string handling (YAML `|` block
scalar or auto-quotes string values). The simplest fix is (a): a post-write YAML parse check
in `quay-native`'s task-write path that returns an error if the written file is not valid YAML.

## Acceptance Criteria

- [ ] `quay-native` task_write (or its YAML serializer) validates the written YAML frontmatter and returns an error if the resulting file would fail to parse
- [ ] A test case covers: writing a task with a `dirStatus` value containing `key: value` patterns, confirms the write either succeeds with a quoted value OR returns a validation error
- [ ] `mcp__plugin_quay_quay__task_list` no longer returns a parse error when one task has a frontmatter value with `: ` in it

## Definition of Done

References the standard inherited-core DoD clauses.

- [ ] quay-native task_write includes post-write YAML validation
- [ ] Test coverage for the colon-in-value case
- [ ] Adversarial audit disposition recorded
