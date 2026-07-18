---
id: exp5-DIR-004
title: "DIR-004: Milestone sizing — cost band via build+verify unit, value-typed
  SELECT"
status: done
labels:
  - directive
parent: null
children: []
extra:
  dirStatus: applied
---
Source: `experiments/quay-perpetual-stream/directives/archive/DIR-004-milestone-sizing-cost-band-and-value-typed-selection.md`

Reviewing exp5's first four milestones (m1-m4, all ABSORB DONE) surfaced two linked gaps in how milestones are sized and selected: the cost axis was handled implicitly ("2 inner iterations" as a bad size proxy) and the value axis not at all (VT prices only one of four observed value types).

Resolution applied at m6 (M-SIZING milestone): milestone size definition + verify-iteration size gauge + value-typed SELECT ledger (capability-growth / discovery / instrument-correction / risk-option / governance-integrity) + governance/infra hard floor all landed in `inherited-core.md`/`OUTER-LOOP.md`; gate-hash-by-reference mechanism demonstrated.

Status mirror: applied

Note: this task uses the experiment-prefixed id `exp5-DIR-004` (design doc `docs/proposals/exp5-task-backlog-primitive-projection.md` §14 item 1) because exp4 already has a pre-existing bare `DIR-004` task occupying that id — a genuine write-time id collision this scheme exists to resolve (M24-task-backlog-projection-impl).