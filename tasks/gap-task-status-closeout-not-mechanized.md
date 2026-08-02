---
id: gap-task-status-closeout-not-mechanized
title: "Direct (non-workflow) execution has no task-status closeout — 7 tasks
  had landed code while still marked todo"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`execute-milestone`'s Land phase writes task status back. **Direct execution — the fast mode that
7/31 showed to be the more efficient path — has no equivalent step.** Nothing closes the task out.

### Measured evidence (2026-08-02)

Seven tasks had their implementing code committed and present in the tree while still carrying
`status: todo`. Verified by grepping for each task's own landing marker:

| Task | Landing marker | Landed in |
|---|---|---|
| `gap-recursive-guard-only-covers-multi-mechanism` | `_rawSplitTriggers` | `4f8495a7` |
| `gap-split-decision-finality-not-enforced` | `splitScopeHash` | `4f8495a7` |
| `gap-plancheck-blocking-only-convergence` | `planCheckNextAction` | `4f8495a7` |
| `gap-plancheck-no-diminishing-returns-exit` | `plancheck-diminishing-returns` | `4f8495a7` |
| `gap-planauthor-shape-rules-not-injected` | `_planShapeContract` | `4f8495a7` |
| `gap-prepare-milestone-epoch-scope-change-grants-full-review` | `bodyScopeHash` | M233 |
| `gap-prepare-milestone-no-worktree-isolation` | `prepare-merge` | M252 |

Consequence: **the task board misreports what is done.** Scheduling reads the board. A task whose
work is already in the tree can be selected, prepared, and dispatched again — the same waste class
as the 15 redundant split dispatches, arriving through a different door.

### Second, related drift: task body vs code

A task body can also contradict the code it describes. Confirmed instance:
`gap-planauthor-shape-rules-not-injected` asserted "the stage format is not injected into the
PlanAuthor prompt". Reading the code showed the format **was** injected (lines 1482-1489); the real
gap was two different constraints. The task was only implemented correctly because the executor
read the source instead of trusting the body.

An executor that trusts the body implements the wrong thing.

## Chosen mechanism

A **detector**, not an enforcer — the honest shape, because "is this task done?" is not
mechanically decidable in general. `experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts`
(byte-identical `plugin/scripts/` mirror) that reports SUSPECT tasks for human review:

For each task with `status: todo` or `ready`:
1. Extract backticked identifiers from the task's `## Acceptance Criteria` that look like new code
   symbols (function/const names, file basenames)
2. `grep` them across `experiments/*/scripts/`, `plugin/scripts/`, `.claude/workflows/`,
   `packages/*/src/`
3. If a high fraction resolve AND every `## Touches` file exists → flag `status-drift-suspect`
4. Exit 0 always; print a review list. **Never auto-mutates a task's status** — the decision
   between `done` and `ready` depends on whether an AC needs a real dispatch, which the script
   cannot judge.

Plus a documented closeout step in the fast-mode execution path (already added to
`docs/analysis/fast-mode-execution-prompt.md`; this task makes it checkable).

**Deliberately NOT built:** a gate that blocks on drift. False positives are certain (a task may
legitimately name an existing symbol it extends), and a blocking gate on a fuzzy signal would be
worse than the leak it prevents — ADR-021 Principle 1.

## Acceptance Criteria

- [ ] AC1: `task-status-drift-check.ts` exists in both mirrors, byte-identical
- [ ] AC2: Run over the current task store, it flags zero false positives among tasks whose code genuinely is not landed (spot-check ≥5 `todo` tasks)
- [ ] AC3: Given a synthetic fixture task whose declared symbols all exist, it reports `status-drift-suspect`
- [ ] AC4: Given a fixture task whose symbols do not exist, it reports nothing
- [ ] AC5: Exits 0 in all cases (report-only, never a gate)
- [ ] AC6: Never writes to `tasks/**` — grep-confirmable, zero write calls
- [ ] AC7: `--json` mode emits `{suspects: [{taskId, matchedSymbols, touchesAllExist}]}`

## Definition of Done

- [ ] Detector implemented, both mirrors, with fixture-based RED/GREEN tests
- [ ] Run against the real task store; output reviewed and any true drift corrected
- [ ] Fast-mode prompt references the detector as the closeout verification step

## Touches

- experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts
- plugin/scripts/task-status-drift-check.ts
- plugin/test/task-status-drift-check.test.mjs
- docs/analysis/fast-mode-execution-prompt.md
