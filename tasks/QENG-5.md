---
id: QENG-5
title: Wire exp5's DoD gate through quay gate (close QENG-0's exp5-integration AC)
status: done
labels:
  - initiative:epicd-engine-port
parent: QENG-0
children: []
extra: {}
---
## Proposal
The engine (QENG-1..4) is BUILT but UNWIRED from exp5: `experiments/quay-perpetual-stream/OUTER-LOOP.md` still invokes `scripts/it0-dod-check.sh` as prose, and `grep` finds ZERO `quay gate/complete/run` calls in exp5's operative files; exp5 milestone tasks carry no `extra.acceptance` meter. So resuming exp5 as-is would use NONE of the engine — the engine is currently designed-not-wired into exp5 (the exact disease it was built to cure). This task closes QENG-0's remaining AC by wiring AT LEAST ONE exp5 DoD check to run THROUGH `quay gate`. In scope (unlike QENG-1..4): editing `experiments/quay-perpetual-stream/**` — that IS the integration. Design decision (pick in proposal): (a) register an `exp5-dod` gate in `packages/quay/src/gate/registry.js` that shells out to `it0-dod-check.mjs` given a milestone, or (b) set `extra.acceptance` on exp5 milestone tasks = the it0-dod-check command and use QENG-2's default acceptance gate. Prefer whichever needs the least new code while being reproducible.

## Acceptance Criteria
- [x] `quay gate <exp5-milestone-task> --gate exp5-dod` (or `quay gate <task>` via an acceptance meter) exits 0 for a compliant milestone and 1 for a synthetic violating one — i.e. exp5's `it0-dod-check.mjs` actually runs THROUGH the quay engine, not as a bare shell call.
- [x] `experiments/quay-perpetual-stream/OUTER-LOOP.md` step 6 (ABSORB) invokes the quay gate command (grep confirms it references `quay gate`, replacing/supplementing the bare `it0-dod-check.sh` call).
- [x] Regression BOTH sides: `node --test packages/quay/test/gate.test.mjs packages/quay/test/acceptance.test.mjs packages/quay/test/lifecycle.test.mjs packages/quay/test/driver.test.mjs` passes, AND exp5's own `scripts/dod-fixture-selfcheck.sh` still exits 0.
- [x] tests >=80% on any new quay gate code, actually run (paste output). — N/A: approach (b) added ZERO new quay source; the AC3 two-sided regression IS the test of the reused acceptance→runAcceptance path.

## Definition of Done
References the standard + tests >=80%. Every AC is a runnable command. On green, tick QENG-0's "At least one exp5 DoD check is invoked via quay gate" AC and re-evaluate whether QENG-0 (epic) can close.

## Acceptance audit (2026-07-19, human-run — LITERAL commands against master 75fca21)
Approach (b): reuse QENG-2's acceptance gate, zero new quay source. Verified independently:
- AC1: `quay gate QENG-5-DEMO-PASS` → EXIT=0, `quay gate QENG-5-DEMO-FAIL` → EXIT=1; `gate-log` shows a GateEvent (gate=acceptance, verdict=pass/fail) → proves exp5's `it0-dod-check.sh` ran THROUGH the engine, not a bare shell call. Meters persisted in the two committed fixture tasks.
- AC2: `grep -cE "quay (gate|complete|run)" experiments/quay-perpetual-stream/OUTER-LOOP.md` → 5 (baseline was 0); step 6's DoD sub-step now names the `quay gate <milestone-task>` route, keeping it0-dod-check.sh as the underlying check.
- AC3: engine tests 89/89 pass; `dod-fixture-selfcheck.sh` EXIT=0 (exp5 side unbroken). AC4 N/A (zero new quay source).
This closes QENG-0's "at least one exp5 DoD check invoked via quay gate" AC — the engine is no longer shelfware from exp5's view.