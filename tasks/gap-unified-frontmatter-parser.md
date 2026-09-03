---
id: gap-unified-frontmatter-parser
title: "Unify task frontmatter parsing: single schema source"
status: ready
labels: []
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Three independent frontmatter readers evolved in this codebase with different semantics:
1. `store.ts parse()` — full YAML.parse()
2. `task-schema.ts parseTask()` — lenient hand-parse (scalars only)
3. `task-schema.ts readDependsOn()` — regex on raw frontmatterRaw string

This redundancy makes the schema implicit and hard to extend. When new fields (like depends_on) are added to one reader, keeping all three synchronized is manual and error-prone. Schema documentation is scattered across comments, making it invisible to users.

Result: New users can't discover supported fields because no single canonical schema exists. Maintainers must manually keep three independent parsers in sync.

## Plan

N/A — simple scope permits direct implementation from Proposal
## Acceptance Criteria

- [ ] Single-source `parseFrontmatterCompletely()` function implemented
- [ ] Canonical schema documented as TypeScript interface (in task-schema.ts comments)
- [ ] parseTask, readDependsOn, store.parse all delegate to parseFrontmatterCompletely
- [ ] task_write MCP schema explicitly lists depends_on (not just via extra escape hatch)
- [ ] Schema documentation example in docs/references/
- [ ] All existing consumers unchanged; behavioral equivalence tests pass
- [ ] Round-trip test: task_write(depends_on) → store → all three readers ✓

## Definition of Done

Standard clauses (architecture + code + tests):
- [ ] Architecture design reviewed by domain expert
- [ ] All refactored consumers work unchanged
- [ ] Full test coverage of all three paths through parseFrontmatterCompletely
- [ ] Schema documentation readable by both humans and code-analysis tools
- [ ] No behavioral changes observable to end users or existing clients

## Touches

- `plugin/scripts/task-schema.ts` (major refactor + new parseFrontmatterCompletely)
- `packages/quay-native/src/store.ts` (validate parse() aligns with schema)
- `packages/quay-native/src/mcp-server.ts` (update task_write schema)
- `docs/references/task-schema-canonical.md` (new canonical schema doc)
- `tasks/gap-unified-frontmatter-parser.md` (self)