## M202 ABSORB entry

**Milestone id:** M202
**Task:** DIR-126-C (generation-aware resume for `prepare-milestone.js` —
`decideResumeGeneration` in `proposal-convergence.ts` — third child of DIR-126's split)
**Charter:** experiments/quay-perpetual-stream/charters/M202-dir126c-generation-aware-resume.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-126-C | Generation-aware resume for `prepare-milestone.js` — a pure `decideResumeGeneration` function in `proposal-convergence.ts` (+ a new `--decide-resume`/`--record-generation` CLI pair on that same file) replaces the caller-supplied `resumeFromAdjudicatedProposal` boolean with a fail-closed, hash/provenance-derived `cold`/`resume`/`reuse-terminal` decision; `_releaseLeaseAndRecord` replaces `_releaseLease` at all 15 real terminal-return sites | TBD | - | milestone-candidate, human-steered, priority:urgent, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow
infrastructure: .claude/workflows/prepare-milestone.js + plugin/workflows/prepare-milestone.js,
experiments/quay-perpetual-stream/scripts/proposal-convergence.ts + plugin/scripts/ mirror, and
their test files. Touches NO packages/quay* product code, so the product-touching surface labels
(cli/web-ui/provider-abi/mcp) do NOT apply. Deliberately does NOT touch
prepare-admission-check.ts or .gitignore (WIRING-CLAIM R9, mechanically confirmed clean via
`git diff --stat`).

The audit-disposition / ABSORB-gate-run sections below are completed during the Land phase
(adversarial acceptance audit + 7-gate absorb run), per inherited-core.md.
-->

## Adversarial audit disposition (M202)

TBD — completed by the Audit phase.

## ABSORB gate run (M202, post-audit)

TBD — completed at Land.
