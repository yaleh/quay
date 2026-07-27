# M188 — Make SELECT synthesize and choose singleton/composite MilestoneCandidates (DIR-119-A)

**Task:** DIR-119-A · **Counter:** 188 · **Chart:** 2
**Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~1.1 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0 (capability-growth, deliverable). This is Phase 1 (Stages 1.1-1.6) of the O4 control-plane
change defined in `docs/plans/adaptive-composite-milestone-select-and-execution.md` (full data
contracts in that doc's §3, referenced not duplicated here) and DIR-119's own Proposal. Current
SELECT ranks individual tasks, truncates to concurrency, then authors one charter per task —
missing valid wide composites (a natural 3-10 task cluster with real coupling) and lacking the
temporal-dependency vocabulary to reject invalid small ones (e.g. a 2-task next-generation proof
chain that must NOT be combined). This milestone changes ONLY the SELECT side: candidate synthesis,
scoring, and portfolio choice — arbitrary-width EXECUTION is DIR-119-B's scope, not this one's.

**Bootstrap-paradox note** (per DIR-119's own Proposal: "split into three ordered children so the
generation that implements the selector/workflow cannot certify its own wiring"): this milestone's
own build/audit CANNOT be the proof that the new mechanism actually wires into a real SELECT cycle
— that is explicitly DIR-119-C's job, on a cold, later generation. This milestone's own DoD item 5
says exactly that: "operational wiring remains assigned to DIR-119-C rather than self-certified
here." Do not attempt to close that gap in this milestone; leave it open for DIR-119-C.

## Scope
Per `tasks/DIR-119-A.md`'s own Acceptance Criteria and the plan doc's Phase 1 stages:

1. **Stage 1.1 — RED fixtures**: deterministic historical-replay fixtures for (a) DIR-114 + M176
   capture-gap + DIR-115 as a 3-task workflow-hardening candidate, (b) DIR-109-DIR-112 producing
   multiple comparable shapes (not one forced bundle), (c) DIR-062-B→DIR-062-C kept SEPARATE by
   their next-generation proof edge, (d) a 10-task homogeneous reconciliation group NOT rejected for
   cardinality, (e) a disconnected value-inflating addition rejected, (f) no task in two candidates.
   RED = current SELECT cannot represent any of these — must be shown failing before Stage 1.2.
2. **Stage 1.2 — Task facts + coupling graph**: pure, fixture-driven `TaskCandidate` fact
   extraction + `CouplingKind`-typed edges (plan doc §3.1-3.2) — reuse existing `## Touches`
   parsing/orthogonality logic (`touches-orthogonality-check.ts`), do not fork it.
3. **Stage 1.3 — Candidate synthesis**: bounded seed/beam expansion (retain every eligible
   singleton; seed from ranked tasks; expand via positive coupling + required-dependency closure;
   prune cycles/temporal-proof-edges/disconnected additions/negative marginal contribution). NO
   power-set enumeration, NO cap on `taskIds.length`.
4. **Stage 1.4 — Portfolio choice**: score by union value, fixed-cost savings, critical path,
   cadence, coordination cost, resource use, atomic-failure cost; choose non-overlapping set under
   concurrency/budget constraints; emit a durable decision record (selected AND rejected shapes,
   with reasons).
5. **Stage 1.5 — Preparation feedback**: invalidate→refact→regenerate→reselect loop, capped at 3
   rounds, then route to human review (never loop silently forever).
6. **Stage 1.6 — Wiring + GREEN**: wire through `select-preflight.ts` + its workflow wrapper +
   OUTER-LOOP SELECT + plugin/runtime mirrors/packaging checks. GREEN = every Stage 1.1 fixture
   passes AND all existing SELECT/preflight fixtures + single-task legacy behavior remain green.

**Compatibility invariants that MUST hold** (plan doc §2, non-negotiable): a one-task
`MilestoneCandidate` reproduces today's single-task path; existing `{taskId, charterFile,
absorbEntryFile}` calls still work (normalize to `taskIds:[taskId]`); `candidate_horizon` is
independent of `.quay/loop.yml` concurrency; each task in at most one selected candidate.

**Out of scope**: arbitrary-width EXECUTION (phase DAGs, read-only audit shards, deterministic
reconcile, atomic multi-task Land) — that is DIR-119-B. Cold real-SELECT proof — that is DIR-119-C.

## Touches
- experiments/quay-perpetual-stream/OUTER-LOOP.md
- .claude/workflows/select-preflight.js
- plugin/workflows/select-preflight.js
- experiments/quay-perpetual-stream/scripts/select-preflight.ts
- experiments/quay-perpetual-stream/scripts/*candidate*
- experiments/quay-perpetual-stream/scripts/*coupling*
- experiments/quay-perpetual-stream/scripts/*portfolio*
- plugin/scripts/*candidate*
- plugin/scripts/*coupling*
- plugin/scripts/*portfolio*
- experiments/quay-perpetual-stream/test/select-preflight.test.mjs
- experiments/quay-perpetual-stream/test/*candidate*
- plugin/test/plugin-packaging.test.mjs

## Done-when
1. Versioned `TaskCandidate`/coupling-edge/`MilestoneCandidate`/`MilestonePortfolio` contracts
   exist; singleton is a one-task milestone candidate (compatibility invariant #1).
2. SELECT synthesizes composites before final portfolio selection; selected AND rejected shapes
   recorded with reasons (a real decision record, pasted).
3. All 6 Stage-1.1 historical-replay fixtures pass (RED shown first, then GREEN) — pasted, not
   asserted.
4. No power-set enumeration, no `taskIds.length` cap, `candidate_horizon` independent of
   `.quay/loop.yml` concurrency — demonstrated, not just claimed absent.
5. Preparation-feedback loop caps at 3 rounds and routes to human review on the 4th — demonstrated
   with a synthetic drift scenario.
6. Existing SELECT/preflight tests + legacy singleton selection remain green; new modules have
   sibling coverage ≥ the project's existing threshold; `plugin/test/plugin-packaging.test.mjs`
   passes (mirror parity).
7. DoD item 5 explicitly NOT attempted: no self-certification of real operational wiring — that
   proof is deferred to DIR-119-C on a cold, later generation.

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
