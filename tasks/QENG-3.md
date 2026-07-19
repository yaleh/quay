---
id: QENG-3
title: Phase pipeline + complete/adjudicate/retreat lifecycle (port
  pipeline/complete/adjudicate/retreat)
status: todo
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