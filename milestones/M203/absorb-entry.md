## M203 ABSORB entry

**Milestone id:** M203
**Task:** DIR-126-D (per-generation phase telemetry for `prepare-milestone.js` — committed
`milestones/prepare-telemetry/` records — fourth child of DIR-126's split)
**Charter:** experiments/quay-perpetual-stream/charters/M203-dir126d-prepare-telemetry.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-126-D | Per-generation phase telemetry for `prepare-milestone.js` — one committed, structured JSON telemetry record per `prepare-milestone` dispatch attempt (every phase transition, every terminal outcome, not only the success path), hash-bound into the receipt on success; Mechanism A (`_writeGenerationTelemetry`/`_releaseLease` split, all 19 real call shapes) + Mechanism B (`--telemetry-report <milestoneId>` read-only query) | TBD | - | milestone-candidate, human-steered, priority:urgent, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow
infrastructure: .claude/workflows/prepare-milestone.js + plugin/workflows/ mirror,
experiments/quay-perpetual-stream/scripts/{proposal-convergence.ts,milestone-preparation-check.ts}
+ plugin/scripts/ mirrors, their test files, docs/proposals/quay-prepare-execute-feedback-
convergence.md, and the deferred-scope follow-up gap task. Touches NO packages/quay* product code,
so the product-touching surface labels (cli/web-ui/provider-abi/mcp) do NOT apply. Deliberately does
NOT touch prepare-admission-check.ts (its contention `owner` shape structurally lacks
`fencingToken`, so it cannot host generation-identity logic) or `.gitignore` (the new
`milestones/prepare-telemetry/` tree is git-tracked by construction, confirmed via
`git check-ignore -v` exiting 1).

SPLIT-OR-COMMIT disposition (human-adjudicated 2026-07-30, commit `b8b87c3`): 11 real
`prepare-milestone` dispatches showed `mechanismCount` — an LLM reviewer's own subjective per-round
self-report — oscillate non-monotonically (8→4→≤2→6) without converging, while
wiring-coverage-check.ts stayed deterministically green since round 9. A human coordinator made the
final count determination: Mechanism A (one committed-write contract, A.0-A.5 are necessary
call-site variants) + Mechanism B (`--telemetry-report`, genuinely independently-landable) = 2.
COMMIT, not split. `docs/plans/M203-dir-126-d.md`'s Plan converged through 3 real PlanCheck rounds
(2 auto-revised + 1 human-fixed + independently re-verified, commits `dbb6026`/`ee4296f`); the
receipt at `milestones/M203/preparation.json` was built via `milestone-preparation-check.ts --build`
from this converged, independently-verified state rather than a further automated ProposalReview
re-run.

The audit-disposition / ABSORB-gate-run sections below are completed during the Land phase
(adversarial acceptance audit + 7-gate absorb run), per inherited-core.md.
-->

## Adversarial audit disposition (M203)

TBD — completed by the Audit phase.

## ABSORB gate run (M203, post-audit)

TBD — completed at Land.
