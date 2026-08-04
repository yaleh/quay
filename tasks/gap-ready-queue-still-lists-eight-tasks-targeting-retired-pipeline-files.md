---
id: gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files
title: "8 of 9 status:ready tasks Touch files physically deleted by ADR-022's pipeline retirement — dispatching any of them wastes an agent recreating retired infrastructure"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

Found while picking orthogonal ready tasks to dispatch during the 2026-08-04 second-OOM
recovery tick (outer session). `mcp__quay__task_list({status:'ready', label:'milestone-candidate'})`
returns 9 tasks. Checked every one's `## Touches` against the real tree:

```
$ ls .claude/workflows/execute-milestone.js .claude/workflows/prepare-milestone.js \
     plugin/workflows/execute-milestone.js plugin/workflows/prepare-milestone.js \
     experiments/quay-perpetual-stream/scripts/composite-build.ts
ls: cannot access '.claude/workflows/execute-milestone.js': No such file or directory
ls: cannot access '.claude/workflows/prepare-milestone.js': No such file or directory
ls: cannot access 'plugin/workflows/execute-milestone.js': No such file or directory
ls: cannot access 'plugin/workflows/prepare-milestone.js': No such file or directory
ls: cannot access 'experiments/quay-perpetual-stream/scripts/composite-build.ts': No such file or directory
```

| Task | status | Touches a deleted file? |
|---|---|---|
| DIR-119-D2 | ready | `.claude/workflows/execute-milestone.js`, `composite-build.ts` (both sides) — **all gone** |
| DIR-119-D3 | ready | same pattern, `composite-audit.ts` — **all gone** |
| DIR-119-D4 | ready | same pattern, `composite-reconcile.ts` — **all gone** |
| gap-plancheck-blocking-only-convergence | ready | `.claude/workflows/prepare-milestone.js` (both sides) — **gone** |
| gap-plancheck-no-diminishing-returns-exit | ready | same — **gone** |
| gap-prepare-milestone-no-worktree-isolation | ready | `.claude/workflows/prepare-milestone.js` (both sides), and its own `## Touches` includes `CLAUDE.md` — **gone** |
| gap-recursive-guard-only-covers-multi-mechanism | ready | `.claude/workflows/prepare-milestone.js` (both sides) — **gone** |
| gap-split-decision-finality-not-enforced | ready | only `proposal-convergence.ts` (exists), but its Proposal/AC are scoped against `prepare-milestone.js`'s split-decision recording flow, which is retired |
| DIR-103-C | ready | all real, live `packages/quay/*` files — **the one genuinely dispatchable task** |

**Root cause**: `CLAUDE.md`'s ADR-022 retirement notice ("the classic milestone loop —
`OUTER-LOOP.md` + `prepare-milestone.js` + `execute-milestone.js` + the `composite-*` phases +
... — is retired... physically deleted at `gap-retire-the-prepare-execute-pipeline-cluster`
(2026-08-03)") never propagated to these 8 task bodies' `status`/Touches. They were authored
against the classic-loop pipeline before ADR-022, and nothing marked them `todo`/`needs-human`
or noted their target no longer exists when the pipeline was deleted the next day.

**Why this matters**: a tick that mechanically picks "any `status:ready` task" (as
`plugin/loop/fast-mode-loop-tick.md` step 4 does) has an 8/9 chance of picking a task whose
entire `## Touches` list is dead files — the dispatched subagent would either fail immediately
or, worse, silently recreate the retired pipeline, directly undoing ADR-022's -23648-line
deletion. This tick avoided it only because a human-authored prompt happened to eyeball the
Touches lists before dispatching; the mechanical `checkTouchesPair` gate does not check
file-existence, only pairwise overlap.

## Chosen mechanism

Two candidate fixes (pick one, or do both — they're not mutually exclusive):

1. **Retire-tag these 8 task bodies**: re-triage each — either close as `status: needs-human`
   with a note "target deleted by ADR-022, scope no longer applies" (if genuinely obsolete), or
   rewrite `## Touches`/`## Proposal` against the fast-mode-loop replacement mechanisms if the
   underlying concern still applies to the new two-layer loop (e.g. DIR-119-D2/D3/D4's
   phase-DAG-dispatcher concern might still be real for whatever replaced `execute-milestone.js`,
   or might not — check before assuming either way).
2. **Add a mechanical dispatch-eligibility check**: before a tick dispatches a `status:ready`
   task, verify every entry in `## Touches` that is NOT tagged `(new)`/`(delete)` actually exists
   in the tree; a ready task whose Touches are majority-nonexistent should be flagged, not
   silently dispatched. This generalizes the existing "Touches expansion" work
   (`touches-orthogonality-check.ts`) rather than inventing a new instrument.

**Not doing**: not deleting these 8 task bodies outright — some of them may carry a real,
still-applicable concern that just needs re-scoping against current infrastructure; deleting
would erase whatever thinking already went into them.

## Acceptance Criteria

- [ ] AC1: each of the 8 tasks is re-triaged: either `status: needs-human` with an explicit
      "ADR-022 made this target obsolete" note, or `## Touches`/`## Proposal` rewritten against
      real, currently-existing files (real-run `ls`/`grep` evidence pasted per task)
- [ ] AC2: a mechanical check (new or extended) that a `status:ready` task's `## Touches` file
      list resolves against the real tree is wired into the dispatch-eligibility path used by
      `plugin/loop/fast-mode-loop-tick.md` step 4, so this class can't recur silently
- [ ] AC3: negative control — a genuinely ready task with real, existing Touches (e.g. DIR-103-C)
      is NOT flagged by the new check

## Definition of Done

- [ ] `mcp__quay__task_list({status:'ready'})` no longer contains any task whose `## Touches`
      majority-resolve to nonexistent files, OR each surviving one carries a documented reason
      the check doesn't apply
- [ ] AC1-AC3 real-run evidence pasted into this task body

## Touches

- tasks/DIR-119-D2.md
- tasks/DIR-119-D3.md
- tasks/DIR-119-D4.md
- tasks/gap-plancheck-blocking-only-convergence.md
- tasks/gap-plancheck-no-diminishing-returns-exit.md
- tasks/gap-prepare-milestone-no-worktree-isolation.md
- tasks/gap-recursive-guard-only-covers-multi-mechanism.md
- tasks/gap-split-decision-finality-not-enforced.md
- plugin/scripts/touches-orthogonality-check.ts

## Dispatch review

reviewer: none
