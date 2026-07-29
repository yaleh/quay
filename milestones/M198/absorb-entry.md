## M198 ABSORB entry

**Milestone id:** M198
**Task:** DIR-119-D1 (real manifest phase/shard synthesis at the SELECT/dispatch boundary — first
child of DIR-119-D's 5-way split)
**Charter:** experiments/quay-perpetual-stream/charters/M198-dir119d1-manifest-synthesis.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-119-D1 | Real manifest phase/shard synthesis (composite-manifest-synthesis.ts + plugin mirror) at the SELECT/dispatch boundary — converts a SELECT-produced flat MilestoneCandidate into a CompositeManifest{phases[], auditShards[]}; select-preflight.js portfolio passthrough; OUTER-LOOP.md execute() invocation wiring | TBD | - | milestone-candidate, human-steered, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow
infrastructure (.claude/workflows/select-preflight.js, experiments/.../OUTER-LOOP.md,
experiments/.../scripts/composite-manifest-synthesis.ts + plugin/scripts mirror, the associated
experiments/test + plugin/test suites, plus plugin/scripts/gate-script-base.ts + sync-vendor.sh's
SYNC_SCRIPTS entry — a pre-existing plugin-mirror-completeness gap this milestone's own new
plugin/test/ coverage newly exercised and closed, see Iteration-0 report). It touches NO
packages/quay* product code, so the product-touching surface labels (cli/web-ui/provider-abi/mcp)
do NOT apply — method-infra is the accurate label, and it0-dod-check.ts clause 7 (product
test-floor) is correctly N/A for this milestone.

The audit-disposition / ABSORB-gate-run sections below are completed during the Land phase
(adversarial acceptance audit + 7-gate absorb run), per inherited-core.md.
-->

## Adversarial audit disposition (M198)

TBD — completed by the Audit phase.

## ABSORB gate run (M198, post-audit)

TBD — completed at Land.
