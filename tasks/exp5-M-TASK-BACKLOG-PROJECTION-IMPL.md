---
id: exp5-M-TASK-BACKLOG-PROJECTION-IMPL
title: Implement M-TASK-BACKLOG-PROJECTION's design (this milestone itself, M24)
status: done
labels:
  - milestone-candidate
  - milestone:M24-task-backlog-projection-impl
  - surface:method-infra
parent: null
children: []
extra: {}
---
## Forward-looking candidate provenance
Forward-looking milestone-candidate task, created by M24-task-backlog-projection-impl (design doc §6 forward-looking-creation scope). Source: backlog.md row "M-TASK-BACKLOG-PROJECTION-IMPL" (open/pending before this write; this row IS this milestone's own charter source — self-referential: M24 creates and then, at its own SELECT-equivalent moment, is already the milestone executing this row).

## Source
DIR-015 item 1 (satisfied by the row's own creation, at m21) + DIR-015 item 2 (this row's own SELECT work, executed here at M24) + the m13 design doc docs/proposals/exp5-task-backlog-primitive-projection.md §15

## Value type / cadence
explore, capability-growth (primary) + governance-integrity (secondary)

## Notes
This task is written with status noted as in-progress in its body (native provider status enum has no in-progress value pre-M24 wiring — see Phase 3's SELECT status-transition convention; this specific bootstrapping task predates that wiring point in its own execution, so its own status field is left `todo` here and is expected to be moved to `done` at this milestone's own ABSORB per Phase 3 Stage 3.3, once the wiring it itself builds exists).

## Status mirror
todo (self-referential open candidate — this milestone is its own SELECT+dispatch; status transitions to done at ABSORB, per Phase 3's own newly-built write-back mechanism)
## Execution record
Milestone: M24-task-backlog-projection-impl
Iteration: iteration-0 (single build pass covering Phases 1-4)
Branch: exp5-m24-iteration-0
Outcome: Phases 1-4 landed — DIR-projection anti-drift script updated (id-scheme/ignore-sections/resolved-synonym), M01-M12 backfill + forward-looking candidates written, OUTER-LOOP.md SELECT/ABSORB wiring authored, backlog-regen + backlog-projection anti-drift checks built, Web UI verified, test suite run.
Value: Δv̂ = 0 (method infra, no VT chart cell).
