---
id: DIR-124-A1b
title: "Stage-event emission instrumentation at 8 workflow boundaries"
status: todo
labels: [directive, milestone-candidate]
parent: DIR-124-A1
children: []
extra: {schema: v1}
---

**type:** execution

## Proposal

Split from DIR-124-A1. Instrument execute-milestone.js and prepare-milestone.js to emit structured stage events using the A1a schema module at all workflow boundaries.

### Chosen mechanism

Add `_emitStageEvent()` helper (importing the A1a schema module via `agent()`-dispatched CLI) at each phase boundary in both workflows:
- prepare-milestone.js: Prepare admission (1 boundary)
- execute-milestone.js: Verify, Prepared, Build, Audit, Gate, Reconcile, Land (7 boundaries)

Event emission is fire-and-forget — never branched on.

## Acceptance Criteria

- [ ] All 8 stage boundaries emit events with valid schema
- [ ] Event log written to .workflow-events/<runId>.jsonl (gitignored)
- [ ] Emission failure never blocks the workflow
- [ ] Both workflow mirrors byte-identical after instrumentation
- [ ] Tests RED/GREEN proving emission at each boundary
- [ ] No post-Land Wiring Audit, lifecycle-promotion policy, worktree redesign, stage scheduler, or resource lease

## Definition of Done

Standard inherited-core DoD clauses apply.

## Touches

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `.claude/workflows/execute-milestone.js`
- `plugin/workflows/execute-milestone.js`
- `experiments/quay-perpetual-stream/scripts/*stage-event*`
- `plugin/scripts/*stage-event*`
