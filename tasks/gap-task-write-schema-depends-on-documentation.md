---
id: gap-task-write-schema-depends-on-documentation
title: Document task_write MCP depends_on field usage
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: v1
---
## Proposal

The `task_write` MCP tool's schema is incomplete regarding the `depends_on` field. Users cannot discover that `depends_on` must be passed through `extra: { depends_on: [...] }` because:
1. No top-level parameter defined in the Zod schema (mcp-server.ts)
2. No documentation in comments or CLAUDE.md
3. Schema validation doesn't define the `extra` sub-structure

This blocks new users from writing prerequisite task relations through MCP, though `readDependsOn()` and dispatch/promotion checks work correctly internally.

## Plan

N/A — documentation update only, no code behavior change

## Acceptance Criteria

- [ ] `packages/quay-native/src/mcp-server.ts` task_write schema comment explains `depends_on` usage
- [ ] Example shows: `extra: { depends_on: [dep1, dep2], schema: "v1" }`
- [ ] CLAUDE.md updated with task_write + depends_on usage section
- [ ] `plugin/scripts/task-schema.ts` parseTask() limitation documented
- [ ] Worked example of round-trip added to docs/references/

## Definition of Done

- [ ] Code and docs reviewed
- [ ] No merge conflicts with develop
- [ ] Commits have proper attribution
- [ ] All documentation cross-links updated

## Touches

- `packages/quay-native/src/mcp-server.ts`
- `plugin/scripts/task-schema.ts`
- `CLAUDE.md`
- `docs/references/task-schema-round-trip.md` (if created)
- `tasks/gap-task-write-schema-depends-on-documentation.md` (self)