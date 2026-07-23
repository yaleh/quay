---
id: exp5-M-DASHBOARD-ROLLING-CUT
title: "Dashboard rolling-cut archive: trim live dashboard to ≤1200 lines,
  archive m25..m125 to dashboard-archive/"
status: done
labels:
  - milestone-candidate
  - governance-integrity
  - milestone:M-131
parent: null
children: []
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-DASHBOARD-ROLLING-CUT
    experiments/quay-perpetual-stream/charters/M131-dashboard-rolling-cut.md
    /tmp/m131-absorb-entry.md
  schema: v1
---
## Proposal

Dashboard context-budget gate reports 1192/1200 lines — 8 lines from the cap. The M78 rolling-window
discipline requires archiving m25..m125 content to `dashboard-archive/` and retaining only the last ~5
milestones in the live dashboard. This operational debt has been accumulating since M78 and now must be
addressed before the next milestone pushes the dashboard over the cap.

Also re-run `it0-backlog-regen.ts` as required by OUTER-LOOP step 7 after archival.

## Plan

N/A — operational housekeeping. Archive old log entries to dashboard-archive/, run regen script, verify
dashboard stays under 1200 lines.

## Acceptance Criteria
- [x] m25..m125 log entries archived to `dashboard-archive/` following DIR-054 rolling-window format
- [x] Dashboard stays under 1200 lines after archival
- [x] `it0-dashboard-line-budget-check.sh` exits 0 after archival
- [x] `it0-backlog-regen.ts` exits 0
- [x] Standard non-flaky suite stays green

## Definition of Done
Standard inherited-core DoD clauses apply.
- [x] Dashboard operational debt cleared (≤1200 lines confirmed)
- [x] Archive preserves all historical milestone entries
- [x] it0 DoD meta-enforcer passes