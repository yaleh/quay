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

adversarial-audit disposition: REFUTED — fresh-context acceptance audit (2026-07-31, session
9b3ffa31-5bd7-4274-86f3-74def2f0a1f1; audit artifact: milestones/M205/audits/iteration-0-acceptance-
audit.md). AC 1-6 of 7 CONFIRMED by the audit's own live runs: both regex fixes source-verified
(canonical module lines 50/102, plugin mirror byte-identical), genuine RED-before/GREEN-after
fixtures (pre-fix module: 3 new tests fail / 19 pass of 22, genuine-`owns` control green under both
literals; post-fix: 22/22), canonical suite green, sync-vendor.sh --check CLEAN, CLI vs
tasks/DIR-126-D.md ok:true/0 findings post-fix (verdict-invariant vs pre-fix ok:true/22 claims),
prepare-admission-check.test.mjs 74/74 both copies, and the gap-path check (Requested action vs AC)
on the task's own file still ok:true post-fix. AC 7 REFUTED: the delivered fix flips THIS task
file's own directive-mode --task self-check from ok:true (pre-fix, 29 claims, live-reproduced in a
temp tree at the HEAD module) to ok:false (post-fix, 1 of 28 claims uncovered — the Fix-2
claim-layer example prose in the Proposal's Fixture design bullet now self-extracts a chunk whose
backtick-pairing artifacts (identifiers {x2.ts, y2.ts, ") asserting"}) no AC bullet covers),
falsifying AC 7's round-5 assertion "this bullet makes the directive-mode check return ok:true on
this task's own file" and its "exhaustive union of every claim this Proposal's own ## Proposal text
extracts under the CLI --task mode" standard (that union was computed under the pre-fix extractor).
The Build's iteration-0 AC-7 disposition never re-ran the self-check post-fix. The substantive
grounding standard (every listed identifier real, confirmed by direct source read) still holds;
only the self-coverage assertion is refuted. DoD "Landed on master" deliberately unchecked
(uncommitted working tree; Land-phase action); DoD real-evidence item confirmed. Independence
disclosure: the audit shares CLAUDE_CODE_SESSION_ID with the session whose task list carried the
Build phase; independence was maintained at the evidence level — fresh context, every verdict from
the audit's own live execution, and the determining finding REFUTES the implementer's AC-7
self-report.

V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward
(verbatim from `bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 201
experiments/quay-perpetual-stream/v-meta-ledger.md`, exit 0, run 2026-07-31 by this audit;
milestone_counter=201 K=2, both rows [ok]).

## ABSORB gate run (M205, post-audit)

TBD — completed at Land.
