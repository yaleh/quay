## M204 ABSORB entry

**Milestone id:** M204
**Task:** DIR-126-E (recalibrate the prepare-milestone capacity model from real telemetry —
`--capacity-report` aggregation — fifth and final child of DIR-126's split)
**Charter:** experiments/quay-perpetual-stream/charters/M204-dir126e-capacity-report.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-126-E | Recalibrate the prepare-milestone capacity model from real telemetry — a purely additive `--capacity-report --telemetry-glob 'milestones/prepare-telemetry/**/*.json'` aggregation mode on `milestone-preparation-check.ts` (both mirrors) emitting P50/P85 wall time + summed agent-minutes by class/highRisk/terminal/decision, mechanical-vs-content dispatch work, prepared/attempt ratio, terminal/decision yield, absorbed-task/prepare-hour, concurrent duplicate-generation minutes, unchanged-terminal recomputation, reuse-terminal hits, and explicit exclusions; reads ONLY checked-in artifacts (never session JSONL); regenerates the throughput-capacity doc from real output with traceable sample provenance | TBD | - | milestone-candidate, human-steered, priority:urgent, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow
infrastructure: experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts +
plugin/scripts/ mirror, its test file, and docs/proposals/quay-milestone-workflow-throughput-
capacity-model.md. Touches NO packages/quay* product code, so the product-touching surface labels
(cli/web-ui/provider-abi/mcp) do NOT apply. Purely additive: a new CLI mode on an existing script
plus a doc regeneration; no existing check changes shape or becomes stricter.

The audit-disposition / ABSORB-gate-run sections below are completed during the Land phase
(adversarial acceptance audit + 7-gate absorb run), per inherited-core.md.
-->

## Adversarial audit disposition (M204)

TBD — completed by the Audit phase.

## ABSORB gate run (M204, post-audit)

TBD — completed at Land.
