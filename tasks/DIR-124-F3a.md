---
id: DIR-124-F3a
title: "Parent Touches amendment (add child script globs to tasks/DIR-124-F.md)"
status: todo
labels:
  - directive
  - milestone-candidate
parent: DIR-124-F3
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

Split from DIR-124-F3 (M259, ProposalReview disposition `split-recommended` /
`split-multi-mechanism`) — the **parent Touches amendment**. The milestone's implementation files
(`task-schema.ts`, `prepare-admission-check.ts`, their test mirrors, and the task-schema helper
scripts) are NOT covered by the parent DIR-124-F task's current `## Touches` globs (`*ground-truth*`
only). A Plan-stage `- Files:` line naming any of those files would itself trip
`preflight-touches-mismatch` — the very gate the F1/F2/F3 family fixes. This child owns the
amendment: the parent task's `## Touches` is amended (task_write, early) to add the child script
globs so every dependent child's Plan `- Files:` lines pass preflight.

### Chosen mechanism

1. **Parent Touches amendment (task_write, early)** — the resolving milestone amends the parent
   DIR-124-F task's `## Touches` (and, where needed, the F3 parent's) to add:
   - `experiments/quay-perpetual-stream/scripts/*task-schema*` + `plugin/scripts/*task-schema*`
   - `experiments/quay-perpetual-stream/scripts/*prepare-admission-check*` +
     `plugin/scripts/*prepare-admission-check*`
   - the test mirrors (`*task-schema*.test.mjs`, `*prepare-admission-check*.test.mjs` in both
     `experiments/` and `plugin/` test dirs).
2. **Preflight-touches-mismatch stays satisfiable** — after the amendment, any Plan-stage
   `- Files:` line naming a hygiene-gate implementation/test file matches a declared Touches entry,
   so the milestone's own `preflight-touches-mismatch` gate passes.
3. **Scope is a task-file edit only** — no script, test, or workflow file is modified by this child;
   the script/test edits belong to F3b (fixtures) and F3c (mirror-drift close).

**WIRING-CLAIM (F3a-PARENT-TOUCHES-AMEND):** the parent DIR-124-F task's `## Touches` (amended
early via task_write) declares the `*task-schema*` and `*prepare-admission-check*` script + test
globs for both mirrors, so a Plan-stage `- Files:` line naming any of them does not trip
`preflight-touches-mismatch`. → AC1: Touches coverage; the dependent children's `- Files:` lines
pass preflight.

## Acceptance Criteria

- [ ] The parent DIR-124-F task's `## Touches` declares `*task-schema*` and
  `*prepare-admission-check*` globs (scripts + tests, both mirrors), applied early via task_write.
- [ ] A Plan-stage `- Files:` line naming `task-schema.ts`, `prepare-admission-check.ts`, or their
  test files passes `preflight-touches-mismatch` (GREEN), not a violation.
- [ ] The amendment is recorded in the task's own `## Touches` before PlanAuthor of any dependent
  child runs.
- [ ] No script, test, or workflow file is modified by this child (`git diff --stat` shows only the
  task file edit + plan).

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] One real prepare-milestone preflight passes with `- Files:` lines naming the
  hygiene-gate implementation files (real dispatch evidence).
- [ ] A fresh independent audit finds no refutation.

## Touches

- `tasks/DIR-124-F.md`
- `docs/plans/M267-dir-124-f3a.md`
