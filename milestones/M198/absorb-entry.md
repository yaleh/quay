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

## Adversarial-audit disposition write-back (iteration-0, this audit)

adversarial-audit disposition: REFUTED — 14/18 AC + 2/4 DoD items independently re-confirmed with
real evidence (test 15/15 green, import greps, byte-identical mirrors, real proof-run artifacts),
but a genuine, previously-undisclosed regression was found live on master: this milestone's own
edit to plugin/scripts/sync-vendor.sh (adding composite-manifest-synthesis/gate-script-base to
SYNC_SCRIPTS, both outside this task's declared ## Touches) breaks
plugin/test/plugin-packaging.test.mjs's M136 hardcoded-count test (24 !== 22, reproduced live,
confirmed not pre-existing via git show eaed20a~1). Full report:
milestones/M198/audits/iteration-0-acceptance-audit.md.

## Adversarial-audit disposition write-back — follow-up (2026-07-29, same-day coordinator-dispatched
fix pass, resolved at this Land)

adversarial-audit disposition: **NOT-REFUTED** (superseding the iteration-0 REFUTED verdict above,
not deleting it — the REFUTED finding was real and is preserved as history; this entry records how
it was resolved). Two independent agent dispatches, both fresh-context, no memory of each other or
of the original iteration-0 audit:

1. **Regression fix (closes the iteration-0 REFUTED finding).** `plugin/test/plugin-
   packaging.test.mjs`'s hardcoded `okCount===22` assertion replaced with a dynamic derivation from
   `sync-vendor.sh`'s own `SYNC_SCRIPTS` array length — closes the whole recurring-drift class (this
   literal had been manually bumped at M188/M189/M191/M193 and missed once, here). Verified: 34/34
   pass on that file; full canonical `scripts/test.sh` — 605 tests, 602 pass, 0 fail, 3 skipped
   (expected live-GitHub tests). Commit `ac8f4b4`.
2. **Remaining AC closure.** With human authorization, `restart-readiness-check.sh` confirmed
   preconditions and the repo-root `.halt` sentinel was briefly removed to dispatch a real
   `Workflow({scriptPath: '.claude/workflows/select-preflight.js'})` run — its own returned JSON
   carries a real, non-empty `portfolio` (run `wf_0e8f7297-a67`), closing WIRING CLAIM 3/AC14. Its
   literal top-ranked candidate (`composite:DIR-099+DIR-103+DIR-104`, real, `status:todo`) was run
   through the exact synthesis→preflight chain `OUTER-LOOP.md` documents, closing AC1/WIRING CLAIM
   4/AC15 and fully resolving the AC8 CONCERN. AC18 (legacy golden-replay) closed via a stronger
   proof than originally planned: `execute-milestone.js` (both mirrors) has zero diff across this
   milestone's entire commit range, so the legacy single-task path is unaffected by construction.
   Commit `3baf61c`.

An independent re-audit (fresh context, no memory of either the original audit or the fix work)
verified BOTH of the above from first principles rather than trusting checked-in artifacts or
task-body annotations: live-ran the regression test, live-re-ran `composite-preflight.ts` against
the checked-in evidence, and — going further than instructed — independently regenerated the entire
`composite:DIR-099+DIR-103+DIR-104` manifest from scratch from the raw portfolio entry and confirmed
it was byte-identical to the checked-in evidence file. Also independently confirmed:
`it0-dod-check.sh` PASS (12/12 dispositions), `wiring-coverage-check.ts` still
`wiring-coverage-complete`, the gap-task is schema-valid, and the AC bullets' newly-added evidence
citations genuinely say what they claim. 18/18 AC checked, all independently verified genuine across
the two audit passes. Full follow-up report: `tasks/DIR-119-D1.md`'s own "Audit disposition —
follow-up" section (same content, task-canonical copy).

## V_meta consolidation-lag (re-run at this Land)

PASS: no confirmed-unconsolidated row past K without a dated carry-forward (milestone_counter=195
K=2, both ledger rows [ok] — consolidated / proposed — verbatim from `vmeta-lag-check.sh --counter
195 experiments/quay-perpetual-stream/v-meta-ledger.md`, re-run this pass). **PHI CONSOLIDATION
CHECK (M198):** neither ledger row was reused unchanged by this milestone — the manifest
phase/shard synthesis mechanism (`composite-manifest-synthesis.ts`) is a genuinely new module built
on top of, not a reuse of, either ledger row (the `domain-audit-channel≡CI-job` row is already
`consolidated`, nothing to re-consolidate; the `repo-root isolation-leak lesson` row concerns
`.halt`-path/workspace-root scoping, an unrelated failure mode to manifest-synthesis fusion logic);
no citation crosses the φ threshold, nothing consolidates into `inherited-core.md` this pass.

## Mechanical gates re-run at this Land

`vmeta-lag-check.sh --counter 195` PASS · `tree-hygiene-check.sh` clean · `worktree-branch-hygiene-
check.sh` clean · `composite-manifest-synthesis.test.mjs` 15/15 pass · `sync-vendor.sh --check`
CLEAN for `scripts/composite-manifest-synthesis.ts`.
