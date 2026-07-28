## M195 ABSORB entry

**Milestone id:** M195
**Task:** DIR-117-B (DIR-117 AC#11/DoD real-landing — prove the Prepared-gate preparation pipeline)
**Charter:** experiments/quay-perpetual-stream/charters/M195-dir117b-prepared-gate-real-proof.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-117-B | Prove the Prepared-gate preparation pipeline via one real milestone (M195 is vehicle + payload): real prepare→execute route, ProposalReview wired to the real checkWiringCoverage() call site, opt-in→enforced-by-default Prepared flip in both mirrors, real negative control, OUTER-LOOP.md disclosure update | TBD | - | directive, human-steered, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow infrastructure
(.claude/workflows/*, plugin/workflows/*, experiments/.../scripts/wiring-coverage-check.ts +
plugin/scripts mirror, the plugin/test + experiments test suites, OUTER-LOOP.md docs, fixtures,
milestones/M195/**). It touches NO packages/quay* product code, so the product-touching surface
labels (cli/web-ui/provider-abi/mcp) do NOT apply — method-infra is the accurate label, and
it0-dod-check.ts clause 7 (product test-floor) is correctly N/A for this milestone.

The audit-disposition / ABSORB-gate-run sections below are completed during the Land phase
(adversarial acceptance audit + 7-gate absorb run), per inherited-core.md.
-->

## Adversarial audit disposition (M195)

_Filled at Land (adversarial fresh-context acceptance audit)._

## ABSORB gate run (M195, post-audit)

_Filled at Land (vmeta-lag, dashboard line-budget, tree-hygiene, worktree-branch-hygiene,
split-or-commit, DoD meta-enforcer, audit-independence)._
