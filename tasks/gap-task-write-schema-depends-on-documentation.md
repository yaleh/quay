---
id: gap-task-write-schema-depends-on-documentation
title: Document task_write MCP depends_on field usage
status: needs-human
labels: []
parent: null
children: []
extra:
  depends_on:
    - gap-scoped-gate-m120-negative-control-false-positive
  schema: execution
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
## Needs-Human

**执行 2026-09-03T06:28:58.142Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: == split-or-commit whole-store check (DIR-026, gap-split-or-commit-not-continuously-checked) ==
- run_id：wk-prod-1788285192
- session_id：036c8068-a66a-445f-89c2-4f67ca0d39ab
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-task-write-schema-depends-on-documentation~wk-prod-1788285192~1788416314593-e8001f.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-task-write-schema-depends-on-documentation-wk-prod-1788285192.log
