---
id: gap-task-write-schema-depends-on-documentation
title: Document task_write MCP depends_on field usage
status: ready
labels: []
parent: null
children: []
extra:
  schema: v1
---
## Proposal

The `task_write` MCP tool's schema is incomplete regarding the `depends_on` field. 

Users cannot discover that `depends_on` must be passed through `extra: { depends_on: [...] }` because:
1. No top-level parameter defined in the Zod schema
2. No documentation in code comments or CLAUDE.md
3. No indication that nested extra is supported

This blocks new users from writing prerequisite task relations through MCP. Internally, `readDependsOn()` works correctly and all dispatch/promotion checks function properly — only the public interface documentation is missing.

## Plan

N/A — simple scope permits direct implementation from Proposal
## Acceptance Criteria

- [ ] `packages/quay-native/src/mcp-server.ts` task_write comment includes depends_on example
- [ ] Example: `extra: { depends_on: [dep1, dep2], schema: "v1" }`
- [ ] CLAUDE.md or new docs/references/ file documents task_write + depends_on usage
- [ ] `plugin/scripts/task-schema.ts` parseTask() limitation is documented
- [ ] Code review confirms all documentation is accurate and discoverable

## Definition of Done

Standard clauses (inherited; this is docs-only, no new shipped code):
- [ ] Documentation reviewed for accuracy and completeness
- [ ] No conflicts with develop branch
- [ ] Changes committed with proper attribution
- [ ] Cross-links updated where applicable
- [ ] No temporary files or debug code left

## Touches

- `packages/quay-native/src/mcp-server.ts`
- `plugin/scripts/task-schema.ts`
- `CLAUDE.md`
- `tasks/gap-task-write-schema-depends-on-documentation.md` (self)