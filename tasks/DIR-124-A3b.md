---
id: DIR-124-A3b
title: "Invariant-ownership DoD gate integration"
status: todo
labels: [directive, milestone-candidate]
parent: DIR-124-A3
children: []
extra: {schema: v1}
---

**type:** execution

## Proposal

Split from DIR-124-A3. Wire the enforcement script into the DoD gate (it0-dod-check.ts).

### Chosen mechanism

Add a new clause to it0-dod-check.ts that shells out to workflow-invariant-ownership.mjs and records the deletionList for downstream consumption by DIR-124-B/C/D.

## Acceptance Criteria

- [ ] New clause in it0-dod-check.ts shells out to enforcement script
- [ ] Clause follows existing unconditionally-dispositioned pattern (matching clauses 3/4/10/11/12)
- [ ] Enforcement output (deletionList) consumed by DIR-124-B/C/D
- [ ] Gate failure blocks Land
- [ ] Tests RED/GREEN
- [ ] No post-Land Wiring Audit, lifecycle-promotion policy, worktree redesign, stage scheduler, or resource lease

## Definition of Done

Standard inherited-core DoD clauses apply.

## Touches

- `experiments/quay-perpetual-stream/scripts/it0-dod-check.ts`
- `experiments/quay-perpetual-stream/scripts/it0-dod-check.sh`
