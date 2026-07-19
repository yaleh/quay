---
id: QENG-4
title: "Driver: quay run — autonomous loop as code (port
  driver/run/scan/supervisor) [optional, last]"
status: todo
labels:
  - initiative:epicd-engine-port
parent: QENG-0
children: []
extra: {}
---
## Proposal
OPTIONAL, LAST — only after QENG-1..3 are green. Port epicd's driver (`src/engine/driver.ts` `run.ts` `scan.ts` `supervisor.ts`) into `quay run` — the autonomous loop as CODE that scans the board, dispatches ready tasks, runs gates, completes. This is what would eventually REPLACE exp5's OUTER-LOOP.md prose entirely (the loop calls `quay run` instead of interpreting 330 lines of prose).

## Acceptance Criteria
- [ ] `quay run --once` processes one ready task end-to-end (dispatch -> gate -> complete) and stops (exit 0).
- [ ] `quay run` honors a stop sentinel (e.g. `.quay/.stop`) — clean exit at the next boundary.
- [ ] Proof-of-concept: one exp5 OUTER-LOOP step is expressed as a `quay run` invocation and reproduces the same board transition.
- [ ] tests >=80% on the driver module, actually run (paste output).

## Definition of Done
References the standard + tests >=80%. Every AC is a command. Explicitly DEFERRABLE: may stay todo until QENG-1..3 land and are proven in exp5.