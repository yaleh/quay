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

## Audit disposition (M202 Iteration-0, written by the adversarial acceptance audit)

adversarial-audit disposition: CONCERNS

V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward (bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 197 experiments/quay-perpetual-stream/v-meta-ledger.md; milestone_counter=197 K=2; rows: "consolidated | lag=- | consolidated — lag gate does not apply | domain-audit-channel≡CI-job pattern (+ per-subcommand audit exercise)", "proposed | lag=- | proposed — not past φ threshold, no lag gate | repo-root isolation-leak lesson")
