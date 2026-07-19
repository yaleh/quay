---
id: QENG-4
title: "Driver: quay run — autonomous loop as code (port
  driver/run/scan/supervisor) [optional, last]"
status: done
labels:
  - initiative:epicd-engine-port
parent: QENG-0
children: []
extra: {}
---
## Proposal
OPTIONAL, LAST — only after QENG-1..3 are green. Port epicd's driver (`src/engine/driver.ts` `run.ts` `scan.ts` `supervisor.ts`) into `quay run` — the autonomous loop as CODE that scans the board, dispatches ready tasks, runs gates, completes. This is what would eventually REPLACE exp5's OUTER-LOOP.md prose entirely (the loop calls `quay run` instead of interpreting 330 lines of prose).

## Acceptance Criteria
- [x] `quay run --once` processes one ready task end-to-end (dispatch -> gate -> complete) and stops (exit 0).
- [x] `quay run` honors a stop sentinel (e.g. `.quay/.stop`) — clean exit at the next boundary.
- [x] Proof-of-concept: one exp5 OUTER-LOOP step is expressed as a `quay run` invocation and reproduces the same board transition.
- [x] tests >=80% on the driver module, actually run (paste output).

## Definition of Done
References the standard + tests >=80%. Every AC is a command. Explicitly DEFERRABLE: may stay todo until QENG-1..3 land and are proven in exp5.

## Acceptance audit (2026-07-19, human-run — LITERAL CLI commands against a correct workspace)
Verified independently against `master` (commit `e2e6726`), correct `.quay/config.yml` (provider MAP + `mcp_entry`):
- AC1: `quay run --once` on a `ready`+`acceptance:'exit 0'` task → EXIT=0, task→`done`; re-run → EXIT=0 "nothing to do".
- AC2: `touch .quay/.stop; quay run` → EXIT=0, "stop=sentinel", the ready task left untouched. (With no sentinel, `quay run` loops to fixpoint → EXIT=0, task→done — the loop actually drives the board.)
- AC3 POC: `driver.test.mjs` fixture `POC-1 {ready, acceptance:'true'}` → `quay run --once` → status `done` + `complete` pass GateEvent, on a self-contained quay workspace (never touches `experiments/**`).
- AC4: `node --test --experimental-test-coverage packages/quay/test/driver.test.mjs` → 22/22, `driver.js` 100% line/branch/funcs. Regression `gate`+`acceptance`+`lifecycle` → 67/67.
Implementation: `packages/quay/src/gate/driver.js` (`isActionable`/`scanActionable(seen)`/`runOnce`/`runLoop` with sentinel+fixpoint+cap) + `bin/quay.js` `run` command (`--once` resets exitCode 0). 630 insertions. Plan: `docs/plans/11-quay-driver.md`. Proposal: `docs/proposals/proposal-quay-driver.md`. This is the capstone — the autonomous loop as CODE, the executable counterpart to exp5's OUTER-LOOP.md prose.