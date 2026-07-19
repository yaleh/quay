---
id: QENG-1
title: Gate engine + GateEvent log (port gate-event-store/adjudicate-gate/gate-log)
status: todo
labels:
  - initiative:epicd-engine-port
parent: QENG-0
children: []
extra: {}
---
## Proposal
Generalize quay's `task check` / `--enforce-gate` into a **gate engine**: `quay gate <task> [--gate <name>]` evaluates named gates and records a **GateEvent** (queryable via `quay gate-log <task>`). Port epicd `src/core/gate-event-store.ts` (GateEvents as data) + `src/engine/adjudicate-gate.ts` + `gate-log.ts`, adapted to quay's provider store.

## Acceptance Criteria
- [ ] `quay gate --list` lists registered gates (exit 0).
- [ ] `quay gate <compliant-fixture> --gate dod` exits 0; `quay gate <violating-fixture> --gate dod` exits 1.
- [ ] Each gate run appends a GateEvent; `quay gate-log <task> --json` lists them.
- [ ] `bun test` (or node test) on the new gate module passes with >=80% coverage on new lines (paste output).

## Definition of Done
References the standard (this initiative's runnable-AC rule) + tests >=80% actually run. Every AC above is a command, not prose.