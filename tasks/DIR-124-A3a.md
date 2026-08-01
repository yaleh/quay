---
id: DIR-124-A3a
title: "Invariant-ownership manifest format + enforcement script"
status: todo
labels: [directive, milestone-candidate]
parent: DIR-124-A3
children: []
extra: {schema: v1}
---

**type:** execution

## Proposal

Split from DIR-124-A3. Define the invariant-ownership.md manifest format and enforcement script.

### Chosen mechanism

1. Manifest format: `experiments/quay-perpetual-stream/invariant-ownership.md` — a markdown file with `## Invariant:` blocks listing authoritative owners for each invariant rule.
2. Enforcement script: `workflow-invariant-ownership.mjs` — validates that every [authoritative] owner path resolves to an existing file, rejects duplicate authoritative owners.

## Acceptance Criteria

- [ ] Manifest format documented with schema
- [ ] Enforcement rejects two authoritative owners for the same rule
- [ ] Enforcement validates owner paths exist on disk
- [ ] Byte-identical mirrors at plugin/
- [ ] Tests RED/GREEN
- [ ] No post-Land Wiring Audit, lifecycle-promotion policy, worktree redesign, stage scheduler, or resource lease

## Definition of Done

Standard inherited-core DoD clauses apply.

## Touches

- `experiments/quay-perpetual-stream/invariant-ownership.md (new)`
- `experiments/quay-perpetual-stream/scripts/workflow-invariant-ownership.mjs (new)`
- `plugin/scripts/workflow-invariant-ownership.mjs (new)`
- `experiments/quay-perpetual-stream/test/*invariant-ownership*.test.mjs`
- `plugin/test/*invariant-ownership*.test.mjs`
