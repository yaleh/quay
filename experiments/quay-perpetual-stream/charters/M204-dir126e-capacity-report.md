# M204 — DIR-126-E: recalibrate the prepare-milestone capacity model from real telemetry
(`--capacity-report` aggregation)

**Task:** DIR-126-E · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.3 K · **type:** execution · **highRisk:** no

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). Fifth and final child of DIR-126's
5-way split. Closes DIR-126's own measured gap: `docs/proposals/quay-milestone-workflow-throughput-
capacity-model.md` states a flat "15-25 minute" Prepare planning assumption with no supporting
distribution, sample count, or provenance, while DIR-126's own Finding measured M195's real Prepare
at ~80 minutes (57 of them PlanCheck alone) — 3-5x the documented assumption. Depends on
[[DIR-126-A]] (landed `a0aba1f`/M200), [[DIR-126-B]] (landed `528897c`/M201), [[DIR-126-C]] (landed
`8c9d114`/M202), and [[DIR-126-D]] (landed `6a24bf3`/M203, `milestone_counter` 199→200 — this
child's own real sample data source; DIR-126-D's own committed telemetry records are what
`--capacity-report` aggregates).

## Structural sample-threshold dependency (explicit, per the task's own Risks section)

This child's own DoD requires "at least three post-change real preparation generations of different
terminal shapes" as its real sample set — not a synthetic-only demonstration. As of this charter's
authoring, zero real telemetry records exist anywhere under `milestones/prepare-telemetry/`
(confirmed via `find`; the directory does not yet exist) — DIR-126-D's own Land just landed the
telemetry-writing code, and every telemetry record produced during DIR-126-D's own real-dispatch
evidence-gathering was, per established convention, from disposable fixtures deleted before commit
(never landed to `master`). This child's own `prepare-milestone` dispatch will itself produce the
first real sample; reaching the ≥3-sample DoD bar realistically requires this child's own dispatch
plus real dispatches of other pending work in the backlog (or additional real, non-disposable
generations of this same task if it needs more than one round) to accumulate a genuine sample set
before the AC/DoD-required real regression proof can be run. Per the task's own Risks section, this
dispatch should not "begin in earnest" (i.e. attempt the real `--capacity-report` regression proof)
until that sample threshold is realistically reachable — Prepare/Build may proceed once the code is
written and unit-tested; the AC items demanding real sample provenance are the ones structurally
gated on this.

## Why not highRisk

Unlike DIR-126-A/B/C/D, this child touches only `milestone-preparation-check.ts` (+ mirror) — a new,
additive, read-only aggregation CLI mode over existing checked-in artifacts (telemetry records +
receipts). It does not touch `prepare-milestone.js`'s own control-plane script (the file class
responsible for every real production crash this session's DIR-126 work encountered) nor
`proposal-convergence.ts`'s decision logic. No existing check changes shape or becomes stricter
(Compatibility section, task's own text).

## Scope

Per `tasks/DIR-126-E.md`'s own Requested action / Acceptance Criteria / Definition of Done — not
duplicated here. In short: a new `--capacity-report --telemetry-glob 'milestones/prepare-telemetry/
**/*.json'` aggregation mode on `milestone-preparation-check.ts` (+ `plugin/scripts/` mirror),
emitting P50/P85 wall time, dispatch-attempt/prepared-ratio, mechanical-vs-content agent work,
duplicate-generation/unchanged-terminal-recomputation waste classes, and explicit exclusions — read
only from checked-in artifacts, never Claude Code session JSONL. The throughput doc is regenerated
from the command's real output with real, traceable sample provenance.

## Touches

Per `tasks/DIR-126-E.md`'s own `## Touches` list — not duplicated here.

## Done-when

Per `tasks/DIR-126-E.md`'s own AC/DoD. A fresh independent audit explicitly briefed to confirm the
report's numbers trace back to real, checked-in telemetry artifacts (not session prose or
hand-edited documentation), and that the ≥3-real-sample DoD bar is met with genuine, non-fixture
production data, not disposable-fixture stand-ins.

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
