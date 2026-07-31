## M205 ABSORB entry

**Milestone id:** M205
**Task:** gap-wiring-coverage-check-whose-own-and-bold-marker-splitting (fix two confirmed regex
defects in wiring-coverage-check.ts: WIRING_VERB_RE's possessive-determiner exclusion omits `whose`
(false-positives on "whose own"), and splitSentences()'s per-block split never breaks at a markdown
bold marker, merging adjacent bolded sub-points into one oversized "claim")
**Charter:** experiments/quay-perpetual-stream/charters/M205-gap-wiring-coverage-checker-fixes.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| gap-wiring-coverage-check-whose-own-and-bold-marker-splitting | Fix two confirmed regex defects in wiring-coverage-check.ts (both mirrors): (Fix 1) add `whose` to WIRING_VERB_RE's possessive-determiner exclusion lookbehind (strict narrowing — genuine ownership claims still match); (Fix 2) widen splitSentences()'s per-block split boundary on BOTH sides (`(?<=[.!?\|]\*\*)...`) so adjacent bolded claims split into separate claims with disjoint identifier sets; RED/GREEN regression fixtures in the canonical test file only (no plugin test mirror, per the 22/25 SYNC_SCRIPTS convention); both mirrors byte-identical via sync-vendor.sh | TBD | - | milestone-candidate, human-steered, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow
infrastructure: experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts (+ plugin/scripts/
mirror) and its canonical test file. Touches NO packages/quay* product code, so the product-touching
surface labels (cli/web-ui/provider-abi/mcp) do NOT apply. Strictly narrowing (Fix 1) / strictly
additive split points (Fix 2); no signature/return-shape/config/CLI/schema change.

The audit-disposition / ABSORB-gate-run sections below are completed during the Land phase
(adversarial acceptance audit + 7-gate absorb run), per inherited-core.md.
-->

## Adversarial audit disposition (M205)

TBD — completed by the Audit phase.

## ABSORB gate run (M205, post-audit)

TBD — completed at Land.
