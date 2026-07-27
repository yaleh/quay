# M189 — Execute arbitrary-width composite milestones through phase DAGs, read-only audit shards, deterministic reconcile, and atomic Land (DIR-119-B)

**Task:** DIR-119-B · **Counter:** 189 · **Chart:** 2
**Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~1.1 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0 (capability-growth, deliverable). Phase 2 (Stages 2.1-2.6) of the O4 control-plane change
(`docs/plans/adaptive-composite-milestone-select-and-execution.md`, full contracts in that doc —
referenced not duplicated). DIR-119-A (M188, `status: done`) built the SELECT-side machinery
(candidate synthesis, portfolio choice) but explicitly left it additive/non-load-bearing
(`select-preflight.ts`'s `portfolio` field returned alongside, not replacing, the legacy
`candidates` path — confirmed by M188's independent audit). This milestone builds the EXECUTION
side: `execute-milestone.js` currently accepts one scalar `taskId`; this extends it to accept an
arbitrary non-empty task array (from a `MilestoneCandidate`), execute by PHASE not by task, audit
via read-only shards, reconcile deterministically, and Land atomically.

**Bootstrap-paradox note** (same discipline as DIR-119-A): this milestone's own build/audit cannot
prove the mechanism actually gets EXERCISED by a real cold SELECT→execute cycle producing a genuine
multi-task composite — that is explicitly DIR-119-C's job. DoD item 5 here says exactly that:
"operational wiring remains assigned to DIR-119-C rather than self-certified here." Do not attempt
to close that gap in this milestone.

## Scope
Per `tasks/DIR-119-B.md`'s own Acceptance Criteria and the plan doc's Phase 2 stages:

1. **Stage 2.1 — Argument normalization**: `execute-milestone` accepts both legacy
   `{taskId, charterFile, absorbEntryFile}` and new `{milestoneCandidate, charterFile,
   compositeManifestFile, absorbEntryFile}` forms; both normalize to one non-empty internal task
   array. Reject duplicate/invalid IDs, stale hashes, conflicting legacy/new args — never reject on
   array length.
2. **Stage 2.2 — Composite contract + phase DAG**: mechanical checker proving task membership
   matches candidate/charter/Plan, every task AC maps to ≥1 phase+audit shard, every shared phase
   maps to an integration invariant, phase dependencies are acyclic, union touches/semantic
   resources complete, no forbidden temporal edge internalized, capacity valid, Land atomic. Exercise
   valid 1/3/5/10-task arrays PLUS fail-closed capacity/temporal-dependency fixtures.
3. **Stage 2.3 — Build phase execution**: consumes the checked phase DAG — shared/overlapping
   phases have one owner, independent phases MAY dispatch in parallel within the global resource
   budget, integration barriers join results, task count never maps 1:1 to agent count, iteration
   report maps files/commits/tests/evidence back to tasks AND phases. First implementation MAY
   serialize all phases through one Build lead if parallel dispatch is unavailable — the CONTRACT
   must still be arbitrary-width/phase-based even if the first implementation is conservative.
4. **Stage 2.4 — Read-only audit shards**: checked shards (task/AC, semantic-integration,
   wiring/system where required) auditing the FINAL integrated candidate; one shard may cover
   several homogeneous tasks; immutable per-task/per-AC verdicts + bundle verdict; NO auditor
   ticks boxes, writes absorb dispositions, updates dashboards, or changes lifecycle state (this is
   a hard architectural boundary — Audit stays read-only, Reconcile owns all mutation).
5. **Stage 2.5 — Deterministic reconcile + gates**: ONLY after every required verdict passes —
   validate audit hashes/generation identity, update task checkboxes/provenance in the candidate
   branch, write per-task+bundle absorb dispositions, run task-scoped DoD/split-or-commit gates for
   every member, run milestone-scoped gates once, fail atomically on any error.
6. **Stage 2.6 — Atomic Land + compatibility**: mark all tasks consistently, capture
   charter/manifest/iteration/audits/decision-record, one composite dashboard entry, increment
   `milestone_counter` exactly once regardless of task count, record task-completion count
   separately. Golden-replay legacy singleton behavior byte-for-behavior where applicable. NO
   partial Land.

**Out of scope**: cold real-SELECT proof that a genuine multi-task composite gets synthesized AND
executed end-to-end through this new mechanism in production — that is DIR-119-C's scope entirely.

## Touches
- .claude/workflows/execute-milestone.js
- plugin/workflows/execute-milestone.js
- plugin/scripts/*composite*
- plugin/scripts/*reconcile*
- experiments/quay-perpetual-stream/scripts/*composite*
- experiments/quay-perpetual-stream/scripts/*reconcile*
- plugin/test/*composite*
- plugin/test/*reconcile*
- experiments/quay-perpetual-stream/test/*composite*
- experiments/quay-perpetual-stream/OUTER-LOOP.md
- plugin/test/plugin-packaging.test.mjs

## Done-when
1. `execute-milestone` genuinely accepts both legacy and new argument shapes, normalized to one
   internal task array; no array-length rejection anywhere (schema/prompt/loop/fixture/config).
2. Composite contract checker exists and is exercised: valid 1/3/5/10-task fixtures pass; duplicate
   IDs/stale hashes/uncovered ACs/cycles/forbidden temporal edges/over-capacity fixtures fail
   closed — both sides shown as real output.
3. Build phase demonstrably consumes a phase DAG with shared-phase single-ownership; task count
   does not determine agent count (even if Phase-1-of-this-Stage's implementation serializes phases
   through one lead — the CONTRACT, not necessarily the parallelism, must be arbitrary-width).
4. Audit shards are demonstrably read-only: a real or fixture-driven negative control shows an
   audit-phase agent CANNOT mutate task/absorb/dashboard/counter/lifecycle state.
5. Reconcile only mutates after all verdicts pass; a negative-control fixture shows a failed
   verdict blocks ALL Land mutations (no partial task lifecycle mutation reaches master).
6. Atomic Land: `milestone_counter` increments exactly once regardless of task count; one dashboard
   entry per composite Land, not one per task.
7. Legacy singleton golden-replay stays behavior-compatible — a real single-task dispatch through
   the new code path produces the same outcome as before this milestone.
8. Existing test suites + mirrors green; DoD item 5 explicitly NOT attempted (no self-certified
   operational wiring proof — deferred to DIR-119-C).

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
