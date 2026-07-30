# M206 — gap-prepare-milestone-split-decision-no-finality: typed mechanism inventory + hash-bound
COMMIT/SPLIT decision finality

**Task:** gap-prepare-milestone-split-decision-no-finality · **Class:** development
**Value type:** capabilityGrowth · **Deliverable:** yes · **Charter tokens:** ~0.2 K
**type:** execution · **highRisk:** yes

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). DIR-126-D/M203 ran `prepare-milestone`
11 times without reaching `prepared`: 9 of those were `ProposalReview` split recommendations, driven
by a scalar `mechanismCount` self-report that oscillated non-monotonically (8, 8, 4, 6 observed
across otherwise-similar review rounds of substantially the same scope) with no machine-readable
basis for why. The eventual resolution required a one-off human-adjudicated ruling (`tasks/DIR-126-D
.md` commit `b8b87c3`) explicitly marked "frozen, not to be re-litigated" — this task productionizes
that workaround: replace the ungrounded scalar with a typed mechanism inventory (IDs, ownership,
proof surfaces, dependency edges, independent-shippability reasons) and a hash-bound, persisted
human COMMIT-or-SPLIT decision that later attempts can only reopen after a declared scope-epoch
change, not because a different reviewer counts call sites differently.

## Why highRisk

Touches `.claude/workflows/prepare-milestone.js` (+ `plugin/workflows/` mirror) — the active
control-plane script every future milestone's Prepare stage runs through, the same risk class as
DIR-126-A/B/C/D's own charters — plus `proposal-convergence.ts` (+ mirror), the split-decision and
convergence-loop implementation itself. This changes the SEMANTICS of a preparation stop decision;
the task's own `## Plan` note explicitly requires "golden replay of both legitimate split cases and
the observed DIR-126-D oscillation before production cutover." N=3 proposal authors and the extra
delta-review round are warranted.

## Scope

Per `tasks/gap-prepare-milestone-split-decision-no-finality.md`'s own Requested action / Acceptance
Criteria / Definition of Done — not duplicated here.

## Touches

Per the task's own `## Touches` list — not duplicated here.

## Done-when

Per the task's own AC/DoD. A fresh independent audit explicitly briefed to golden-replay DIR-126-D's
own real 11-round oscillation history against the new typed-inventory mechanism and confirm it would
have reached a stable, non-oscillating decision, not merely that the new code compiles/passes
synthetic unit tests.

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
