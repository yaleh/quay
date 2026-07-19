---
id: QENG-3
title: Phase pipeline + complete/adjudicate/retreat lifecycle (port
  pipeline/complete/adjudicate/retreat)
status: done
labels:
  - initiative:epicd-engine-port
parent: QENG-0
children: []
extra: {}
---
## Proposal
Port epicd's phase pipeline + lifecycle (`src/engine/pipeline.ts` `complete.ts` `adjudicate.ts` `retreat.ts`) into quay commands: `quay promote <task>` (authoring->execution boundary), `quay complete <task>` (runs all gates, blocks on any fail, else status->done), `quay adjudicate <task>` (independent fresh-context audit gate, records a GateEvent), `quay retreat <task>` (roll a task back one phase with a gap contract). Replaces exp5's prose SELECT->ABSORB with code.

## Acceptance Criteria
- [x] `quay complete <task-with-failing-gate>` exits 1 and leaves status unchanged; `quay complete <task-all-gates-pass>` exits 0 and sets status=done.
- [x] `quay adjudicate <task>` records an audit GateEvent (visible in `quay gate-log`).
- [x] An illegal phase transition is rejected with a nonzero exit and a clear message.
- [x] tests >=80% on the lifecycle module, actually run (paste output).

## Definition of Done
References the standard + tests >=80%. Every AC is a command. Depends on QENG-1 (gate engine).

## Acceptance audit (2026-07-19, human-run — LITERAL CLI commands against a correct workspace)
Verified independently against `master` (commit `f0decb4`), running the AC commands as written (correct `.quay/config.yml`: provider MAP with `mcp_entry`):
- AC1: `complete <ready+'exit 1'>` → EXIT=1, status stays `ready`; `complete <ready+'exit 0'>` → EXIT=0, status=`done`; `complete <todo>` → EXIT=1, status `todo` unchanged (precondition: must be ready). `promote <ready+pass>` → EXIT=0, status=done (legal one-step delegating to complete).
- AC2: `adjudicate <task>` → EXIT=0; `gate-log <task> --gate audit --json` shows 1 `audit` GateEvent.
- AC3: `promote <done>` → EXIT=1 `Error: illegal transition: done cannot forward`; `retreat <todo> --reason x` → EXIT=1 `Error: illegal transition: todo cannot back`.
- AC4: `node --test --experimental-test-coverage packages/quay/test/lifecycle.test.mjs` → 25/25, `lifecycle.js` 100% line / 97% branch. Regression `gate.test.mjs`+`acceptance.test.mjs` → 42/42.
Implementation: `packages/quay/src/gate/lifecycle.js` (transition table + runComplete/runAdjudicate/runPromote/runRetreat) + `bin/quay.js` (4 verb-less commands). 713 insertions. Plan: `docs/plans/10-quay-lifecycle.md`. Proposal: `docs/proposals/proposal-quay-lifecycle.md`. Key design: `store.write` does NOT enforce transitions, so `lifecycle.js` does (the `complete` ready-precondition is load-bearing).