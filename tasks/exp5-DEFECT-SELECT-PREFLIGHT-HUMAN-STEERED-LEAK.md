---
id: exp5-DEFECT-SELECT-PREFLIGHT-HUMAN-STEERED-LEAK
title: select-preflight shortlist leaks human-steered-excluded candidates
  (direct label + epic-with-human-steered-only-child)
status: todo
labels:
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-DEFECT-SELECT-PREFLIGHT-HUMAN-STEERED-LEAK
    experiments/quay-perpetual-stream/charters/M181-select-preflight-human-steered-leak.md
    /tmp/m181-absorb-entry.md
---
## Finding

Two independent M173-SELECT observations show `select-preflight.ts`'s human-steered exclusion
(DIR-062-C, "mechanically filtered") is incomplete:

1. **DIR-057** (`label: human-steered` set directly on the task) appeared in select-preflight's
   `shortlist` output (rank 999, deliverable:no) despite carrying the exclusion label. The task's
   own body already documents a prior DRAIN-time note that it should be excluded from autonomous
   SELECT — this is not a new label, the classifier should have caught it on this candidate set.

2. **DIR-070** (an epic/compound task, `role: compound` via non-empty `children`) also appeared in
   the shortlist (rank 999, deliverable:yes — ranked FIRST). All 6 children are `done` except
   `DIR-070-F`, which itself carries `label: human-steered` + `extra.dirStatus: deferred`. So the
   epic DIR-070 has NO autonomous path forward right now (its one open child is explicitly
   human-steered), yet select-preflight surfaced it as the top deliverable:yes candidate — the
   classifier checks the parent's own labels but does not walk to an epic's open children to see
   whether the concrete remaining work is itself human-steered-excluded.

## Requested action

Harden `human-steered-classify.ts` (or `select-preflight.ts`'s candidate-building step) to also
exclude a compound/epic candidate when ALL of its currently-open (non-done) children carry
`label: human-steered` — the epic has no autonomous-executable child, so listing it in the
shortlist is a dead end that wastes a SELECT cycle. Re-verify DIR-057's direct-label case is not a
one-off drain-timing artifact (add a fixture case if the classifier's test suite doesn't already
cover "a plain human-steered-labeled task still present in the raw candidate pool").

## Acceptance Criteria

- [ ] Fixture: an epic with all children done except one human-steered child → NOT in shortlist
- [ ] Fixture: a directly-labeled human-steered task in the raw candidate pool → NOT in shortlist
- [ ] Existing select-preflight tests still pass

## Definition of Done

- [ ] Fix landed in `human-steered-classify.ts` and/or `select-preflight.ts`, tests green
- [ ] A real select-preflight run against the current task store no longer surfaces DIR-057 or
  DIR-070 in its shortlist
- [ ] Satisfies the standard DoD clauses in `experiments/quay-perpetual-stream/inherited-core.md`'s "## Definition of Done" section (real-landing, not asserted)

## Proposal

Extend the mechanical human-steered filter to cover the epic/open-children case, closing the gap
DIR-062-C's "mechanical filtering" claim did not fully cover.

## Plan

N/A — small, targeted fix to an existing checker; no separate plan doc needed.

## Provenance

Filed during the OUTER-LOOP M173 SELECT cycle (2026-07-26) while assembling the batch from
select-preflight's shortlist `[DIR-070, DIR-057, DIR-109, DIR-110]` — both DIR-070 and DIR-057
were manually excluded before charter authoring; this task tracks fixing the classifier so future
cycles don't need the manual check.
