## M200 ABSORB entry

**Milestone id:** M200
**Task:** DIR-126-A (single-flight admission for `prepare-milestone.js` —
`prepare-admission-check.ts`, new `Admission` phase — first child of DIR-126's split)
**Charter:** experiments/quay-perpetual-stream/charters/M200-dir126a-single-flight-admission.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-126-A | Single-flight admission for `prepare-milestone.js` — new `prepare-admission-check.ts` (+ `plugin/scripts/` mirror) implementing `acquireLease`/`renewLease`/`releaseLease`/`checkStaleOwner` (atomic `wx`-create lease, `.quay/prepare-leases/<taskId>.json`), a new unconditional `Admission` phase inserted before `ProposalAuthors` on both cold and resume branches, renewal at all 6 phase boundaries, release at all 11 post-Admission terminal returns, 300m/360m derived staleness window, `--force-release` audited escape hatch | TBD | - | milestone-candidate, human-steered, priority:urgent, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow
infrastructure: .claude/workflows/prepare-milestone.js + plugin/workflows/prepare-milestone.js
(the Prepare-stage control-plane script), experiments/quay-perpetual-stream/scripts/
prepare-admission-check.ts + plugin/scripts/ mirror, their experiments/test + plugin/test suites,
.gitignore, and plugin/scripts/sync-vendor.sh's SYNC_SCRIPTS entry (Plan-declared expansion). It
touches NO packages/quay* product code (verified: `git diff <base>..HEAD -- packages/` prints
nothing — see Iteration-0 report), so the product-touching surface labels (cli/web-ui/provider-abi/
mcp) do NOT apply — method-infra is the accurate label, and it0-dod-check.ts clause 7 (product
test-floor) is correctly N/A for this milestone.

The audit-disposition / ABSORB-gate-run sections below are completed during the Land phase
(adversarial acceptance audit + 7-gate absorb run), per inherited-core.md.
-->

## Adversarial audit disposition (M200)

TBD — completed by the Audit phase.

## ABSORB gate run (M200, post-audit)

TBD — completed at Land.

## Audit disposition write-back (M200, 2026-07-29, iteration-0-acceptance-audit.md)

adversarial-audit disposition: REFUTED
V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward (vmeta-lag-check.sh --counter 195, milestone_counter=195 K=2 — rows: "consolidated | lag=- | consolidated — lag gate does not apply | domain-audit-channel≡CI-job pattern (+ per-subcommand audit exercise)"; "proposed | lag=- | proposed — not past φ threshold, no lag gate | repo-root isolation-leak lesson")

## needs-human legitimacy review (M200, 2026-07-29, DIR-026/ADR-014 Clause 9 check)

A request was made to mark `DIR-126-A` `needs-human` with reason "audit REFUTED — [...] 4 AC items
+ 1 DoD item, each a genuine, independently-confirmed gap: (1) Admission-phase error fail-closed
branching has no fixture driving `prepare-milestone.js` itself into that branch — only the CLI's own
output shape is tested; (2) the only real-concurrency evidence
(`milestones/M200/stage9-two-process-race-evidence.md`) races `prepare-admission-check.ts` directly
via two OS processes, bypassing the `Workflow` harness and `prepare-milestone.js` entirely, so no
`ProposalAuthors` agent-dispatch-count journal evidence exists (self-disclosed by Build); (3) the
6/6 `--renew` call sites are confirmed by static grep only — no fixture dynamically proves renewal
across all six real phase boundaries in one run, and renewal counters collected in
`plugin/test/prepare-milestone-convergence.test.mjs`/`prepare-milestone-preparation-e2e.test.mjs`'s
mocks are never asserted; (4) Grounding evidence group 3 asserts production wiring is "confirmed
distinct from... the module's own `--selftest` self-check mode", but `prepare-admission-check.ts`
has NO `--selftest` mode at all (`grep -n "selftest"` returns zero matches) — a factually false
sub-claim against the final artifact.

**Verification result: this reason is IN-PROJECT, not EXTERNAL — needs-human was NOT applied.**
Per ADR-014 Decision 2 / DIR-026, `needs-human` is legitimate only when completion is blocked by a
factor outside project control (external service/credential/dataset/upstream-not-yet-released or
equivalent). All four items above are ordinary in-project completeness gaps in this repo's own test
suite and this task's own grounding prose — missing fixtures the Build could write, a stale/false
claim the Build could correct, and a concurrency proof the Build's own `iteration-0.md` "Honest
disclosures" section says it could not obtain only because "this Build could not obtain a
Workflow-tool-equipped session inside its own window" (a scheduling/session-window constraint on
*this* generation, not an external blocker on the work itself). None of these name an external
service outage, missing credential, unavailable dataset, or upstream dependency not yet released.

Mechanically confirmed by dry-running the real `it0-dod-check.ts` Clause 9 regexes
(`inProjectRe`/`externalRe`, `experiments/quay-perpetual-stream/scripts/it0-dod-check.ts:719-720`)
against the audited reason text: `externalRe.test(reason) === false` for every clause — no match on
`external|upstream|third-party|credential|token|dataset|...`. Had `DIR-126-A` actually been set to
`needs-human` with this reason, a subsequent `it0-dod-check.sh DIR-126-A ...` run would hit Clause
9's final `else` branch and HARD-FAIL: `` `needs-human` reason (...) does not name a recognizable
OUTSIDE-project blocker ``. Marking this task `needs-human` would therefore have been a genuine
SPLIT-OR-COMMIT violation (DIR-026/ADR-014), not merely a stylistic mismatch.

**Disposition:** `DIR-126-A` status is left `todo` (unchanged) with the 4 REFUTED AC items + false
`--selftest` grounding sub-claim + 1 REFUTED DoD item left unchecked in `tasks/DIR-126-A.md` per
DIR-020 (the audit write-back already performed). Per ADR-014 Decision 3 (mandatory split rule), the
correct next step is either (a) a further Build iteration on this same child that adds the missing
`prepare-milestone.js`-level fixtures (Admission-error fallthrough, real `Workflow`-dispatched
two-concurrent-generation race with journal evidence, per-boundary renewal-count assertions) and
corrects the false `--selftest` sub-claim, or (b) splitting the four REFUTED items into their own
completable children if a single further iteration cannot close all four — never a terminal
`needs-human` park, since none of the four gaps are outside this project's control.
