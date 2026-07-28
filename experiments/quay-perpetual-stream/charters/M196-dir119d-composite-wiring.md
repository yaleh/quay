# M196 — DIR-119-D: literally wire phase-DAG Build, read-only audit shards, deterministic Reconcile into execute-milestone.js

**Task:** DIR-119-D · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.5 K · **type:** execution · **highRisk:** yes

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). DIR-119-B delivered the
arbitrary-width composite execution machinery as checked, tested contract modules
(`composite-build.ts`/`composite-audit.ts`/`composite-reconcile.ts`/`composite-land.ts`) that
`execute-milestone.js` references as agent-prompt guidance but never calls: import-graph check
shows zero production importers for Build/Land and only mutual imports for Audit/Reconcile.
DIR-119-C's real 7-task canary proved SELECT-side synthesis and atomic Land accounting but ran
Build as one monolithic agent and Audit as one non-read-only agent, with no Reconcile phase.
This milestone makes the architecture literal production code — the single most important AC
(per the task's own wording, unmet on its own it fails the whole directive regardless of
everything else) — plus the missing manifest phase/shard synthesis step and the Gate-phase
failure-attribution defect.

## Why highRisk

This milestone edits `.claude/workflows/execute-milestone.js` — the active execution-chain
control plane every future milestone dispatches through — plus its four composite modules, and
the prior DIR-119-C independent audit demonstrably missed exactly these defects (verified
journal call-counts but never traced production import graphs or exercised the Gate-failure
branch). N=3 proposal authors and the extra delta-review round are warranted.

## Prepared-gate note

This is the first milestone dispatched under the M195/DIR-117-B enforced-by-default Prepared
gate: it carries a real `prepare-milestone.js` receipt consumed by its `execute-milestone.js`
dispatch, per the now-required contract (`OUTER-LOOP.md` execute() / concurrent_execute()
shapes). No skip-prepare precedent applies (retired by the flip).

## Scope

Per `tasks/DIR-119-D.md`'s own Requested action / Acceptance Criteria / Definition of Done —
not duplicated here. In short: (1) a real (not test-fixture-only) manifest phase/shard synthesis
step converting a SELECT-produced `MilestoneCandidate.taskIds` into
`CompositeManifest{phases[], auditShards[]}` with a deterministic documented grouping rule and a
real production callsite between SELECT output and execute-milestone dispatch; (2) composite
Build dispatching one agent per manifest phase (respecting `requires` edges); (3) Audit
dispatching one agent per `auditShards[]` entry, each mechanically git-clean-checked before/after
(non-empty diff hard-fails the shard as a read-only violation — not agent self-discipline);
(4) a literal `Reconcile` phase between Audit and Land that is the ONLY phase permitted to write
task/dashboard/absorb state, invoking `composite-reconcile.ts`'s real `reconcile()` (not its
`--selftest`); (5) Gate-failure handling naming the specific failing member task(s), not
`_primaryTaskId` by default; (6) one fresh real composite dispatch exercising the full new
wiring with journal evidence (Build-call count == phase count, Audit-call count == shard count,
Reconcile entry between Audit and Land, atomic Land); (7) RED/GREEN fixtures for both the
hostile-shard-write catch and the failing-member gate attribution; (8) legacy width-1 dispatch
behavior-identical; (9) a fresh independent wiring audit explicitly briefed to trace import
graphs and exercise the Gate-failure branch; (10) re-verify DIR-119-C AC #5/#10 against the fix.

## Touches

Per `tasks/DIR-119-D.md`'s own `## Touches` list — not duplicated here (includes both
execute-milestone.js mirrors, all eight composite-*.ts canonical+vendor files, and the
composite test files).

## Done-when

Per `tasks/DIR-119-D.md`'s own AC/DoD — with the AC #1 import-graph requirement treated as the
gate it declares itself to be. A fresh independent wiring-focused audit after Land, explicitly
briefed on the DIR-119-C audit's blind spot (per the task's own Requested action item 9).

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ 8c781aa9ab7bc634e4a90073b646e1ab4af335d1
