## M201 ABSORB entry

**Milestone id:** M201
**Task:** DIR-126-B (deterministic mechanical preflight for `prepare-milestone.js` — new
`Preflight` phase — second child of DIR-126's split)
**Charter:** experiments/quay-perpetual-stream/charters/M201-dir126b-deterministic-preflight.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-126-B | Deterministic mechanical preflight for `prepare-milestone.js` — five new pure detector functions (`preflight-merged-markdown-claims`/`preflight-stale-ac-refs`/`preflight-touches-mismatch`/`preflight-missing-precedent`/`preflight-invalid-plan-command`) in the shared `prepare-admission-check.ts` module, a new `Preflight` phase gating `ProposalAuthors` (content checks) and `PlanCheck` round 1 (Plan-shape check) | TBD | - | milestone-candidate, human-steered, priority:urgent, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow
infrastructure: .claude/workflows/prepare-milestone.js + plugin/workflows/prepare-milestone.js,
experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts + plugin/scripts/ mirror
(shared with DIR-126-A), wiring-coverage-check.ts (verify-only, no re-fix), and their
experiments/test + plugin/test suites. Touches NO packages/quay* product code, so the
product-touching surface labels (cli/web-ui/provider-abi/mcp) do NOT apply.

The audit-disposition / ABSORB-gate-run sections below are completed during the Land phase
(adversarial acceptance audit + 7-gate absorb run), per inherited-core.md.
-->

## Adversarial audit disposition (M201)

TBD — completed by the Audit phase.

## ABSORB gate run (M201, post-audit)

TBD — completed at Land.
