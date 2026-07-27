---
id: exp5-DEFECT-SELECT-PREFLIGHT-HUMAN-STEERED-LEAK
title: select-preflight shortlist leaks human-steered-excluded candidates
  (direct label + epic-with-human-steered-only-child)
status: done
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

- [x] Fixture: an epic with all children done except one human-steered child → NOT in shortlist
      (evidence: `select-preflight.test.mjs` "M181 case 2 (epic-with-human-steered-only-child)
      GREEN" test, PASS; independently re-derived against real DIR-070/DIR-070-A..F data by this
      audit — `isEpicBlockedByHumanSteeredChildren` returns `true` for DIR-070's actual child set
      (5 done + DIR-070-F open+human-steered))
- [x] Fixture: a directly-labeled human-steered task in the raw candidate pool → NOT in shortlist
      (evidence: `select-preflight.test.mjs` "M181 case 1 (direct label) GREEN" test, PASS;
      independently re-derived against real DIR-057/DIR-113/DIR-114/DIR-115/DIR-116 data by this
      audit — `computeHumanSteered` returns `humanSteered: true` for all 5)
- [x] Existing select-preflight tests still pass (evidence: `node --test
      experiments/quay-perpetual-stream/test/select-preflight.test.mjs` → 30/30 pass, re-run by
      this audit 2026-07-27; commit a8b3c0f only ADDS 9 new `test(...)` blocks, 0 removed/modified)

## Definition of Done

- [x] Fix landed in `human-steered-classify.ts` and/or `select-preflight.ts`, tests green
      (evidence: commit a8b3c0f, `select-preflight.ts` +187/-5 lines — classifier itself
      untouched per charter scope, OR-logic added in `select-preflight.ts`; 30/30 tests pass)
- [x] A real select-preflight run against the current task store no longer surfaces DIR-057 or
  DIR-070 in its shortlist (evidence: this audit ran `node --experimental-strip-types
  select-preflight.ts --json --workspace-root . --milestone-counter 172` against the live task
  store 2026-07-27 — output `candidates` array (14 entries) contains NEITHER DIR-057 NOR DIR-070
  NOR DIR-113/114/115/116, all six correctly excluded from the autonomous shortlist)
- [x] Satisfies the standard DoD clauses in `experiments/quay-perpetual-stream/inherited-core.md`'s "## Definition of Done" section (real-landing, not asserted)
      (evidence: mechanical gate `it0-dod-check.sh` run by this audit — see Mechanical Gate result
      below)

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

## Execution record

- **Milestone:** M181
- **Iteration count:** 1
- **Realized Δv:** 0 (v̂=0 VT-neutral, instrument-correction — SELECT-safety fix, no chart-2
  surface cell moves)
- **Merge commit:** a8b3c0f (`M181: select-preflight ORs direct label:human-steered + walks epic
  children`)
- **Audit verdict:** NO REFUTATION FOUND (`milestones/M181/audits/iteration-0-acceptance-audit.md`)
- **Outcome:** `select-preflight.ts` now ORs the task's own direct `label:human-steered` into each
  candidate's `humanSteered` verdict and excludes compound/epic candidates whose every open child
  is human-steered, closing the live leak that let DIR-057/DIR-070/DIR-113/DIR-114/DIR-115/DIR-116
  surface in the autonomous SELECT shortlist; `human-steered-classify.ts`'s own classifier was
  left untouched per the charter's explicit out-of-scope declaration.
