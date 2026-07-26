---
id: exp5-M-STALE-DEVIATION-CLEANUP-162
title: Update stale deviation row — DIR-070-C fix confirmed, row status still open
status: done
labels:
  - milestone:M162
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-STALE-DEVIATION-CLEANUP-162
    experiments/quay-perpetual-stream/charters/M162-stale-deviation-cleanup.md
    /tmp/m162-absorb-entry.md
---
## Proposal
Update stale deviation row for DIR-070-C in dashboard.md. The it0-impl-row-check.sh backward-compat regression was fixed post-hoc (commit 4d043d3) but the deviation row still shows status "open". Update to "verified-eliminated".

## Plan
N/A — no docs/plans/*.md reference. One-line doc fix: change deviation row status from "open" to "verified-eliminated".

## Acceptance Criteria
- [x] DIR-070-C deviation row status changed from "open" to "verified-eliminated" -- commit 0570ca0 on master; dashboard.md L455 shows `verified-eliminated` status; diff confirms open-to-verified-eliminated transition. Summary rows (a)(b) also updated (machine 31→33, fraction 5/35→6/37). [audit session 28186b2d]

## Definition of Done
Per inherited-core.md standard DoD clauses (0-12). Applicable: 0,1,3,5,10,11. Clauses 2/4/6/7/8/9/12 N/A.
- [x] Deviation row updated — commit 0570ca0 on master; dashboard.md L455 DIR-070-C-impl-row-backward-compat row status changed open→verified-eliminated; fix commit 4d043d3 cited; summary rows (a)(b) updated accordingly. [audit session 28186b2d]

## Execution record
- **Milestone:** M162
- **Iteration count:** 0 (direct commit, no inner iteration)
- **Realized Δv:** 0 (instrument-correction, documentation-only — no chart-2 cell moves)
- **Merge commit:** 0570ca0
- **Outcome:** Done — DIR-070-C stale deviation row status changed open→verified-eliminated in dashboard.md. All mechanical gate clauses resolved (clause7 waived for documentation-only task). Audit verdict CONCERNS, non-blocking.

## Touches
- experiments/quay-perpetual-stream/dashboard.md