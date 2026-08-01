---
id: DIR-124-F4e
title: "DIR-124-F4 Touches self-amendment (declare tasks/DIR-124-F.md + adr/ADR-020)"
status: todo
labels:
  - directive
  - milestone-candidate
parent: DIR-124-F4
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

Split from DIR-124-F4 (M260, ProposalReview disposition `split-recommended` /
`split-multi-mechanism`) — the **Touches self-amendment**. The parent DIR-124-F4 task's `## Touches`
does not currently declare `tasks/DIR-124-F.md` or `adr/ADR-020`, so the F4-M4 child (AC3 prose
reconciliation, which touches those two files) would trip `preflight-touches-mismatch` at Plan
time. This child owns amending the parent's own `## Touches` (task_write, early) to add
`tasks/DIR-124-F.md`, `adr/ADR-020`, and `tasks/DIR-124-F4.md` BEFORE PlanAuthor of any dependent
child runs. It has no dependencies and lands first among the F4 leaf chain that touches the parent
task file.

### Chosen mechanism

1. **Touches self-amendment (task_write, early)** — amend the parent DIR-124-F4 task's `## Touches`
   to add:
   - `tasks/DIR-124-F.md`
   - `adr/ADR-020-runtime-contract-ground-truth-registry.md`
   - `tasks/DIR-124-F4.md`
2. **Ordering** — the amendment is recorded before PlanAuthor of any dependent child (F4-M4, which
   touches those files) so its `- Files:` lines pass preflight.
3. **No script/test edits** — only the parent task file is modified; the registry module, data
   file, and seed doc are untouched.

**WIRING-CLAIM (F4e-TOUCHES-SELF-AMEND):** the parent DIR-124-F4 task's `## Touches` (amended
early via task_write) declares `tasks/DIR-124-F.md`, `adr/ADR-020`, and `tasks/DIR-124-F4.md`, so a
Plan-stage `- Files:` line naming any of them (F4-M4's reconciliation) passes
`preflight-touches-mismatch`. → AC1: parent Touches declares the F4-M4 touched files before
PlanAuthor.

## Acceptance Criteria

- [ ] The parent DIR-124-F4 task's `## Touches` declares `tasks/DIR-124-F.md`,
  `adr/ADR-020-runtime-contract-ground-truth-registry.md`, and `tasks/DIR-124-F4.md`.
- [ ] The amendment is recorded before PlanAuthor of any dependent child runs.
- [ ] No script, test, or workflow file is modified by this child — `prepare-admission-check.ts`
  and `task-schema.ts` (both mirrors) are untouched (`git diff --stat` shows only the task file edit
  + plan), **verified** by a diff that shows zero changes to those files.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] One real prepare-milestone preflight passes for F4-M4 with `- Files:` lines naming the
  declared files (real dispatch evidence).
- [ ] A fresh independent audit finds no refutation.

## Touches

- `tasks/DIR-124-F4.md`
- `docs/plans/M274-dir-124-f4e.md`
- `milestones/M274/preparation.json`
- `milestones/M274/proposal-ledger.json`
- `milestones/M274/stage-journal.jsonl`
- `milestones/M274/receipts/*.json`
- `tasks/DIR-124-F4e.md`
- `.quay/config.yml`
