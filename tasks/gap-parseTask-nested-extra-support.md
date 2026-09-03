---
id: gap-parseTask-nested-extra-support
title: "parseTask: Add support for nested extra structures"
status: done
labels: []
parent: null
children: []
extra:
  schema: v1
---
## Proposal

`parseTask()` currently only supports scalar values in the `extra:` frontmatter block. When `task_write` serializes nested JSON structures to YAML (e.g., `extra: { depends_on: [a, b] }`), parseTask cannot read them back — it returns empty string for nested keys.

This asymmetry breaks the tool ecosystem: `readDependsOn()` correctly parses nested frontmatterRaw strings, but the canonical frontmatter parser (parseTask) fails silently. Users building tools that consume parseTask output miss critical task metadata.

Example: task_write writes `extra: { depends_on: [dep1, dep2] }` → YAML serializes to nested block → parseTask reads it back as `extra.depends_on = \\` (empty string).

## Plan

N/A — simple scope permits direct implementation from Proposal
## Acceptance Criteria

- [x] `parseTask()` or `parseTaskCompletely()` successfully reads nested extra structures
- [x] Unit test: task_write with depends_on array → round-trip → parseTask returns array (not empty string)
- [x] Backward compatibility verified: existing scalar-only extra still works
- [x] Test coverage includes nested lists and nested objects in extra
- [x] Function documentation updated to specify supported structures
- [x] Existing consumers (ready-pool-check, driver-filters) work unchanged

## Definition of Done

Standard clauses (code + tests):
- [x] Code reviewed
- [x] All tests pass (new and existing)
- [x] Real-world task files tested for compatibility
- [x] Commits reference related gap-task-write-schema-depends-on-documentation
- [x] No debug code or experimental branches left

## Touches

- `plugin/scripts/task-schema.ts`
- `experiments/quay-perpetual-stream/scripts/task-schema.ts` (sync-vendor source copy)
- `experiments/quay-perpetual-stream/test/task-schema.test.mjs` (existing test file)
- `tasks/gap-parseTask-nested-extra-support.md` (self)