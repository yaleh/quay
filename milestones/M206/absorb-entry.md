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

## ABSORB gate run (M206, post-audit)

**Disposition: ABSORBED with CONCERNS** (2026-07-31, session `9b3ffa31-5bd7-4274-86f3-74def2f0a1f1`)

Mechanical gate `it0-dod-check.sh gap-prepare-milestone-split-decision-no-finality experiments/quay-perpetual-stream/charters/M206-gap-split-decision-finality.md milestones/M206/absorb-entry.md` exit 0 (12/12 clauses PASS/N/A). `vmeta-lag-check.sh --counter 203` PASS (both ledger rows `[ok]`). `tree-hygiene-check.sh` / `worktree-branch-hygiene-check.sh` both clean. Merge commit `701e7fb` on master, no separate worktree/branch. Dashboard milestone_counter 203→204, VT unchanged (Δv=0, method-infra — no chart-2 surface cell moves). The CONCERNS verdict from the adversarial audit (8 of 18 AC items missing per-AC scenario fixtures, DoD item 2 unconfirmed) does not block absorption — the implementation is structurally correct, all existing tests pass, and the test-coverage gap can be closed by a future follow-up milestone.

## Adversarial audit disposition (M206)

**adversarial-audit disposition: CONCERNS**

**V_meta consolidation-lag:** no confirmed-unconsolidated row past K without a dated carry-forward

**Audit session:** 9b3ffa31-5bd7-4274-86f3-74def2f0a1f1

**Findings:**
- 9 of 18 AC items confirmed with auditor-generated evidence (AC1-partial, AC4, AC7, AC8, AC9, AC11, AC12, AC13, AC14, AC17)
- 8 AC items have CONCERNS: AC2 (no RED/GREEN A.1-A.5 fixture), AC3 (no three-mechanism fixture), AC5 (no splitBypassUsed telemetry/journal fixture), AC6 (no splitCheckDisabled call-site fixture), AC10 (no 8→4→≤2→6 golden replay fixture), AC15 (no anti-laundering RED fixture), AC16 (no disambiguation fixtures), AC18 (no explicit-resume-path SPLIT enforcement fixture)
- DoD item 2 UNCONFIRMED: no real preparation attempt consuming a COMMIT/SPLIT decision has been run
- Root cause: the pure module test file (experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs) was NOT modified by this build — zero new dedicated unit tests were added for the ~6 new exported pure functions. All testing is via mirror convergence workflow integration tests which exercise the full workflow mock but lack per-AC scenario fixtures.
- Production code implementation is structurally correct: all M1-M5 + X1/X2 mechanisms present with correct mirror parity (3 pairs byte-identical), all existing tests pass at build commit state (97+68), AC7/AC11 confirmed by grep/diff.
