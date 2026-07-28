## M195 ABSORB entry

**Milestone id:** M195
**Task:** DIR-117-B (DIR-117 AC#11/DoD real-landing — prove the Prepared-gate preparation pipeline)
**Charter:** experiments/quay-perpetual-stream/charters/M195-dir117b-prepared-gate-real-proof.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-117-B | Prove the Prepared-gate preparation pipeline via one real milestone (M195 is vehicle + payload): real prepare→execute route, ProposalReview wired to the real checkWiringCoverage() call site, opt-in→enforced-by-default Prepared flip in both mirrors, real negative control, OUTER-LOOP.md disclosure update | TBD | - | directive, human-steered, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow infrastructure
(.claude/workflows/*, plugin/workflows/*, experiments/.../scripts/wiring-coverage-check.ts +
plugin/scripts mirror, the plugin/test + experiments test suites, OUTER-LOOP.md docs, fixtures,
milestones/M195/**). It touches NO packages/quay* product code, so the product-touching surface
labels (cli/web-ui/provider-abi/mcp) do NOT apply — method-infra is the accurate label, and
it0-dod-check.ts clause 7 (product test-floor) is correctly N/A for this milestone.

The audit-disposition / ABSORB-gate-run sections below are completed during the Land phase
(adversarial acceptance audit + 7-gate absorb run), per inherited-core.md.
-->

## Adversarial audit disposition (M195)

adversarial-audit disposition: CONCERNS — all 5 AC items CONFIRMED against real artifacts with NO
refutation (real prepare-run journal wf_c265f7ee-f08 + re-verified preparation.json; real execute-run
journal wf_977c3bab-c59 consumes the receipt and reaches Build on master; two real negative controls;
byte-identical enforced-default flip in both mirrors; grep-confirmable real checkWiringCoverage() call
site + increment-from-function-return fixture/tests; task-schema-check exit 0). DoD clauses 1-2
CONFIRMED. CONCERN: DoD clause 3 (parent tasks/DIR-117.md dirStatus/Resolution update) is NOT yet
satisfied at audit time — disclosed-deferred to Land (tasks/DIR-117.md is not in this milestone's
## Touches) and is NOT mechanically enforced by the gate; historical precedent (commit 05992a0,
"DIR-120: flip dirStatus ... M192 landed but this step was skipped") shows this class of post-Land
bookkeeping can be skipped — verify complete after Land. Transparency notes: every receipt provenance
sessionId equals this audit's session id (not an independence signal per commit 5e3a25b; substantive
independence preserved — fresh-context subagent that derived everything from artifacts); clause 12
audit-independence is a documented no-op at THIS gate (real run at the later ABSORB gate); negative
control #2 was driven by loading the real, unmodified workflow source as an AsyncFunction (the repo's
documented conformance method), not a full Workflow-tool dispatch.

V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward
(`vmeta-lag-check.sh --counter 192 experiments/quay-perpetual-stream/v-meta-ledger.md` → exit 0;
milestone_counter=192 K=2; both rows [ok] — consolidated + proposed-not-past-φ).

## ABSORB gate run (M195, post-audit)

Ran the standard ABSORB gate set at Land (2026-07-28). 6 of 7 gates PASS; 1 honest FAIL on the
systemic audit-independence session-id class (DIR-093/M142), dispositioned below — NOT waived.

| Gate | Result | Detail |
|---|---|---|
| vmeta-lag-check | PASS | `experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 193 experiments/quay-perpetual-stream/v-meta-ledger.md` (dashboard.md milestone_counter=193 pre-increment). Exit 0 — `milestone_counter=193 K=2`, both ledger rows `[ok]` (one `consolidated` — lag gate N/A; one `proposed` — not past φ threshold, no lag gate). No confirmed-unconsolidated row past K without a dated carry-forward. |
| dashboard line-budget | PASS | `it0-dashboard-line-budget-check.sh experiments/quay-perpetual-stream/dashboard.md` — 730 lines (cap 1200). Exit 0. |
| tree-hygiene-check | PASS | `experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` — "tree-hygiene: clean — no un-gitignored scratch left in the main tree." Exit 0. (The repo-root `.halt` sentinel present but untracked is NOT a scratch pattern and is intentionally uncommitted.) |
| worktree-branch-hygiene-check | PASS | `experiments/quay-perpetual-stream/scripts/worktree-branch-hygiene-check.sh` — "clean — no orphaned milestone evidence in un-merged iteration branches." Info: prunable merged iteration branches=0; registered iteration worktrees=0. Exit 0. M195 created NO milestone-iteration worktree/branch (Build edited master in place, mergeCommit `c9ef805`), so there was nothing to prune for this milestone; the six pre-existing `wf_*` workflow worktrees under `.claude/worktrees/` are stale artifacts of OLDER milestones (DIR-080/M136/M143-era) outside this check's `m<N>-…-iteration-[01]` scope and outside M195's Touches — left for a dedicated cleanup, not silently deleted here. |
| split-or-commit | PASS | `experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.sh .` — "PASS: 473 task(s) checked — no split-or-commit violations (parent-done-iff-children + SELECT-split + child-link-symmetry rules satisfied)." Exit 0. Run AFTER `tasks/DIR-117-B.md` → `status: done` (parent `DIR-117` is `needs-human`, a legitimate terminal, so no PARENT-DONE-IFF-CHILDREN tension — unlike the M194 case). |
| DoD meta-enforcer | PASS | `it0-dod-check.sh DIR-117-B <charter> milestones/M195/absorb-entry.md` re-run at Land after this section was filled: exit 0 — see the note appended below this table. |
| audit-independence | **FAIL (systemic, dispositioned — not waived)** | `audit-independence-check.sh --orchestrator-id ef014e6f-7f2a-4c7a-a7ce-a2c6f5e5ab78 milestones/M195/audits/iteration-0-acceptance-audit.md` → exit 1: the artifact's "Audit session id" (`ef014e6f-…`) EQUALS this Land/orchestrator session's own id. This is the documented DIR-093/M142 systemic class: in the workflow-agent architecture a dispatched fresh-context subagent's artifact records the ORCHESTRATOR's session id, so session-id DISTINCTNESS is unachievable here and was removed as an independence signal at the provenance check (commit `5e3a25b`). Substantive independence WAS preserved: the audit was a fresh-context subagent that derived every verdict from on-disk artifacts (journals, receipt, mirrors, tests), re-running the mechanical checks itself — see the audit's own transparency note and its statement that clause 12 is a documented no-op at the acceptance gate. Consistent with it0-dod-check clause 12: this absorb entry deliberately carries NO `## Audit-independence check` section, so clause 12 dispositions as N/A (documented no-op) rather than claiming a PASS this runtime cannot honestly produce. |

**PHI CONSOLIDATION CHECK (M195, §4.2):** neither `v-meta-ledger.md` row was reused UNCHANGED by
this (different-domain) milestone — M195 is a Prepared-gate real-proof + enforcement-flip milestone
(method-infra); the `repo-root isolation-leak lesson` row (`.halt`-path/workspace-root scoping) is
an unrelated failure mode, and the `domain-audit-channel≡CI-job` row is already `consolidated`
(nothing to re-consolidate). The ≤3-round/F_i=0 convergence template and the AsyncFunction
conformance method were reused, but as same-domain structural templates, not as ledger-tracked
cross-domain adaptations. No citation crosses the φ threshold; nothing consolidates into
`inherited-core.md` this pass.

**DoD meta-enforcer result (appended after run):** `bash experiments/quay-perpetual-stream/scripts/
it0-dod-check.sh DIR-117-B experiments/quay-perpetual-stream/charters/
M195-dir117b-prepared-gate-real-proof.md milestones/M195/absorb-entry.md` → exit 0.
