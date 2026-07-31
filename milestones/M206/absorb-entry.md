## M206 ABSORB entry

**Milestone id:** M206
**Task:** gap-prepare-milestone-split-decision-no-finality (replace ProposalReview's unstable scalar
mechanismCount with a typed mechanism inventory, root-cause clustering, a bounded repairable bypass,
and a hash-bound human COMMIT-or-SPLIT decision)
**Charter:** experiments/quay-perpetual-stream/charters/M206-gap-split-decision-finality.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| gap-prepare-milestone-split-decision-no-finality | Replace ProposalReview's ungrounded scalar mechanismCount with a typed mechanism inventory (IDs, ownership, proof surfaces, dependency edges, independent-shippability reasons), root-cause clustering (per-subsystem distinct rootCauseKey count, superceding subsystem-string-equality), a bounded one-shot repairable bypass (one focused revision + delta review before terminal split on a repairable cluster; never for split-multi-mechanism; bypass consumed after one use), and a hash-bound human COMMIT-or-SPLIT decision persisted to a check-in-able `milestones/prepare-decisions/<taskId>.json` that suppresses future split adjudication on unchanged scope and blocks content dispatch on a SPLIT; edits `prepare-milestone.js` (both mirrors), `proposal-convergence.ts` (both mirrors), and `milestone-preparation-check.ts` (both mirrors) — the control-plane script + the split-decision function + the receipt-binding engine | TBD | - | milestone-candidate, human-steered, priority:urgent, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow
infrastructure: .claude/workflows/prepare-milestone.js + plugin/workflows/ mirror,
experiments/quay-perpetual-stream/scripts/proposal-convergence.ts + plugin/scripts/ mirror,
experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts + plugin/scripts/ mirror,
and their test files. Touches NO packages/quay* product code, so the product-touching surface labels
(cli/web-ui/provider-abi/mcp) do NOT apply.

The audit-disposition / ABSORB-gate-run sections below are completed during the Land phase
(adversarial acceptance audit + 7-gate absorb run), per inherited-core.md.
-->

## Adversarial audit disposition (M206)

TBD — completed by the Audit phase.

## ABSORB gate run (M206, post-audit)

TBD — completed at Land.
