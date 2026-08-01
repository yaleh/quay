## M230 ABSORB entry

**Milestone id:** M230
**Task:** DIR-099-B (Provider env validation check #9, corrected: native tasks_dir is optional → warn, github missing QUAY_GITHUB_REPO also defaults → warn; present-but-malformed → error)
**Charter:** experiments/quay-perpetual-stream/charters/M230-dir-099-b.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-099-B | Provider env validation (check #9), corrected: native tasks_dir is optional (warn), github missing QUAY_GITHUB_REPO also defaults (warn); present-but-malformed → error. Adds `validateProviderEnv` to `packages/quay/src/config-validate.ts` (shared module), RED/GREEN `config-validate.test.mjs`, real-CLI verdict parity evidence | TBD | - | milestone-candidate, human-steered, surface:cli |

<!--
surface:cli — this milestone touches `packages/quay/src/config-validate.ts` (product code, the
CLI config-validate path) + its test + docs/plans. The config-validate surface is CLI-facing
(feeds `quay config validate`), so `cli` is the accurate product-touching label; `mcp` does NOT
apply (no mcp-handlers.ts change in this milestone).

The adversarial audit disposition + ABSORB-gate-run sections below are completed during the
Audit/Land phases, per inherited-core.md.
-->

## Adversarial audit disposition (M230)

(to be completed at Audit phase)

## ABSORB gate run (M230, post-audit)

(to be completed at Land phase)
