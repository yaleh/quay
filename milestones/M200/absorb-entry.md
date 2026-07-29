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

**Two audit rounds, final disposition CONFIRMED — cleared to land.**

**Round 1 — iteration-0 adversarial acceptance audit** (`milestones/M200/audits/iteration-0-
acceptance-audit.md`, 2026-07-29): verdict **REFUTED** on 4 AC items + 1 DoD item, all genuine,
independently-confirmed gaps (see "Audit disposition write-back" section below for the full
Clause-9 legitimacy analysis of why this was NOT eligible for `needs-human`):

1. AC2 (Admission-phase error is fail-closed) — the branching logic was real and correct on source
   read but no fixture drove `prepare-milestone.js` itself into the `admission-check-failed`
   branch.
2. AC3 (Single-flight RED/GREEN) + the parallel DoD item — the only real-concurrency evidence
   raced `prepare-admission-check.ts` directly via two OS processes
   (`milestones/M200/stage9-two-process-race-evidence.md`), bypassing the `Workflow` harness and
   `prepare-milestone.js` entirely — no real `ProposalAuthors` agent-dispatch-count journal
   evidence existed.
3. AC6 (renewal-at-every-phase-boundary) — the 6/6 `--renew` call sites were confirmed by static
   grep only; renewal counters were collected in the mock-based convergence tests but never
   asserted against an expected count.
4. AC13 (Grounding evidence group 3) — a factually false sub-claim that production wiring was
   "confirmed distinct from... the module's own `--selftest` self-check mode" —
   `prepare-admission-check.ts` has no `--selftest` mode at all.

All four gaps were fixed and committed in `496ccd4`: (1) a real-`AsyncFunction`-plus-mocked-agent
workflow test drives `prepare-milestone.js` into the `admission-check-failed` branch and asserts
zero `ProposalAuthors` dispatches; (2) two real concurrent
`Workflow({scriptPath: '.claude/workflows/prepare-milestone.js'})` dispatches against a disposable
fixture task produced real journal evidence — the loser's entire journal is 2 entries
(`agent_count:1`, zero `ProposalAuthors` dispatches), the winner acquired the lease and dispatched
2 real proposal-author agents (`milestones/M200/evidence/real-two-concurrent-workflow-dispatch-
proof.md` + the two raw journal excerpts alongside it); (3) a test asserting
`admissionRenews === 4` for a resumed 0-delta-round generation, plus `admissionAcquires===1`/
`admissionReleases===1`; (4) the disproven `--selftest` sub-claim was removed from the task text
rather than left standing.

**Round 2 — independent fresh-context re-audit** (dispatched separately from both the Build and
Round 1, no shared context, re-derived every claim from scratch via live source reads and command
execution): verdict **CONFIRMED**. All 15 AC items hold; 3 of 4 DoD items hold (the 4th, "Landed
on master", was correctly left open pre-Land — that is what this Land phase closes). Independently
re-confirmed: `it0-dod-check.sh` PASS (12/12 dispositions); `wiring-coverage-check.ts` 0 findings;
`cmp`/`sync-vendor.sh --check` CLEAN across all four canonical/`plugin/` mirror pairs; the 14
real terminal-return sites in the final `prepare-milestone.js` (12 original + 2 new Admission-phase
pre-acquisition returns) individually verified — pre-Admission sites (line 27 missing-args guard,
lines 104/109 Admission's own pre-acquisition returns) correctly release nothing, all 11
post-acquisition sites each immediately preceded by `await _releaseLease(...)`; `Admission`
(`.claude/workflows/prepare-milestone.js` line 66 / `_admissionAgentCall` dispatch line 94)
confirmed to run strictly before BOTH branches of the `_resumeFromAdjudicatedProposal` split (line
117); `DEFAULT_STALENESS_MS` confirmed exactly `{ordinary: 300 * 60 * 1000, highRisk: 360 * 60 *
1000}`; `.quay/prepare-leases/` confirmed gitignored via `git check-ignore -v`.

**Final disposition: CONFIRMED, cleared to land.** No open AC or applicable-at-this-stage DoD item
remains unresolved; the only DoD item left unchecked going into Land ("Landed on master") is closed
by this Land phase itself (see task file `## Execution record`).

## ABSORB gate run (M200, post-audit)

All four gates re-run live at Land time (2026-07-29), against the already-landed `master` tree
(commit `496ccd4`, working tree clean — nothing new to capture):

**1. `it0-dod-check.sh DIR-126-A experiments/quay-perpetual-stream/charters/M200-dir126a-single-flight-admission.md milestones/M200/absorb-entry.md`** — PASS

```
PASS: clause0-ac-dod-present: task AC has 15 checkable clause(s) (checklist-form, 15/15 checked); DoD references the standard [tasks/DIR-126-A.md]
PASS: clause1-adversarial-audit: disposition statement present (verdict)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget: PASS — scope within the small-milestone norm (no declared line budget > 2000, in-scope item count at or under threshold 8). No phase/stage plan required.
PASS: clause4-impl-row: PASS — DIR-126-A is not design-only per its backlog row text; impl-row gate does not apply.
PASS: clause5-no-self-exemption: no undeclared self-exemption language found (or all found exemptions have a matching WAIVER line)
PASS: clause6-escrow-delta-v: N/A — milestone is not design-only (rule does not apply)
PASS: clause7-test-floor: N/A — surface label(s) [method-infra] are exclusively non-product-touching (method-infra/docs/cross-cutting/packaging)
PASS: clause8-task-canonical-lifecycle-record: N/A — no 'milestone:M<N>' label found — legacy/unlabeled task, predates the DIR-014 item 6 cutover
PASS: clause10-tree-hygiene: PASS — tree-hygiene: clean — no un-gitignored scratch left in the main tree.
PASS: clause11-worktree-branch-hygiene: PASS — worktree-branch-hygiene: clean — no orphaned milestone evidence in un-merged iteration branches.
PASS: clause12-audit-independence: N/A — no '## Audit-independence check' section in the ABSORB-entry text (documented no-op)
N/A: clause9-split-or-commit: no `needs-human` outcome declared — N/A

PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
```
Exit code: 0.

**2. `task-schema-check.sh tasks/DIR-126-A.md`** — PASS

```
PASS: tasks/DIR-126-A.md — schema v1 conformant (kind=milestone-candidate)
1 total, 1 pass, 0 N/A-legacy, 0 fail
```
Exit code: 0.

**3. `tree-hygiene-check.sh`** — PASS

```
tree-hygiene: clean — no un-gitignored scratch left in the main tree.
```
Exit code: 0.

**4. `worktree-branch-hygiene-check.sh`** — PASS

```
worktree-branch-hygiene: clean — no orphaned milestone evidence in un-merged iteration branches.
info: prunable merged iteration branches=0; registered iteration worktrees=0 (ABSORB should prune these).
```
Exit code: 0.

**All four gates: PASS. Cleared for Land.**

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
