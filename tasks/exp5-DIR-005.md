---
id: exp5-DIR-005
title: "DIR-005: V_meta consolidation lag — tracked and gated at ABSORB"
status: done
labels:
  - directive
parent: null
children: []
extra:
  dirStatus: applied
---
Source: `experiments/quay-perpetual-stream/directives/archive/DIR-005-v-meta-consolidation-lag-tracked-and-gated-at-absorb.md`

Analyzing the inner-loop development process (why every milestone m1-m4 ran exactly 2 inner iterations) surfaced a structural cost that is NOT a V_instance problem and was invisible to every existing health track: the inner loop's build+verify specialization defers V_meta absorption indefinitely.

Resolution applied at m7 (M-VMETA-GATE milestone): `v-meta-ledger.md` + `dashboard.md` health track ("V_meta consolidation lag", K=2 alarm) + `OUTER-LOOP.md` ABSORB gate all built and live.

Status mirror: applied

Note: this task uses the experiment-prefixed id `exp5-DIR-005` (design doc `docs/proposals/exp5-task-backlog-primitive-projection.md` §14 item 1) because exp4 already has a pre-existing bare `DIR-005` task occupying that id — a genuine write-time id collision this scheme exists to resolve (M24-task-backlog-projection-impl).