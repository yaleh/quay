## M203 ABSORB entry

**Milestone id:** M203
**Task:** DIR-126-D (per-generation phase telemetry for `prepare-milestone.js` — committed
`milestones/prepare-telemetry/` records — fourth child of DIR-126's split)
**Charter:** experiments/quay-perpetual-stream/charters/M203-dir126d-prepare-telemetry.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-126-D | Per-generation phase telemetry for `prepare-milestone.js` — one committed, structured JSON telemetry record per `prepare-milestone` dispatch attempt (every phase transition, every terminal outcome, not only the success path), hash-bound into the receipt on success; Mechanism A (`_writeGenerationTelemetry`/`_releaseLease` split, all 19 real call shapes) + Mechanism B (`--telemetry-report <milestoneId>` read-only query) | TBD | - | milestone-candidate, human-steered, priority:urgent, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow
infrastructure: .claude/workflows/prepare-milestone.js + plugin/workflows/ mirror,
experiments/quay-perpetual-stream/scripts/{proposal-convergence.ts,milestone-preparation-check.ts}
+ plugin/scripts/ mirrors, their test files, docs/proposals/quay-prepare-execute-feedback-
convergence.md, and the deferred-scope follow-up gap task. Touches NO packages/quay* product code,
so the product-touching surface labels (cli/web-ui/provider-abi/mcp) do NOT apply. Deliberately does
NOT touch prepare-admission-check.ts (its contention `owner` shape structurally lacks
`fencingToken`, so it cannot host generation-identity logic) or `.gitignore` (the new
`milestones/prepare-telemetry/` tree is git-tracked by construction, confirmed via
`git check-ignore -v` exiting 1).

SPLIT-OR-COMMIT disposition (human-adjudicated 2026-07-30, commit `b8b87c3`): 11 real
`prepare-milestone` dispatches showed `mechanismCount` — an LLM reviewer's own subjective per-round
self-report — oscillate non-monotonically (8→4→≤2→6) without converging, while
wiring-coverage-check.ts stayed deterministically green since round 9. A human coordinator made the
final count determination: Mechanism A (one committed-write contract, A.0-A.5 are necessary
call-site variants) + Mechanism B (`--telemetry-report`, genuinely independently-landable) = 2.
COMMIT, not split. `docs/plans/M203-dir-126-d.md`'s Plan converged through 3 real PlanCheck rounds
(2 auto-revised + 1 human-fixed + independently re-verified, commits `dbb6026`/`ee4296f`); the
receipt at `milestones/M203/preparation.json` was built via `milestone-preparation-check.ts --build`
from this converged, independently-verified state rather than a further automated ProposalReview
re-run.

The audit-disposition / ABSORB-gate-run sections below are completed during the Land phase
(adversarial acceptance audit + 7-gate absorb run), per inherited-core.md.
-->

## Adversarial audit disposition (M203)

Two-pass disposition, both fresh-context: iteration-0 (2026-07-30) verdicted **REFUTED** — 19 of 24
AC + 2 of 5 DoD items independently confirmed true, but 5 AC items + 2 DoD items left unconfirmed
(zero committed telemetry records existed anywhere in the repo; 2 dispatch-count AC items demanded
a "real ... journal" but only had a static grep count; the reuse-terminal write-failure RED fixture
was missing; the named 5-milestone backward-compat regression run had only one generic proxy test).
Full report: `milestones/M203/audits/iteration-0-acceptance-audit.md`.

A same-day, 3-commit coordinator-dispatched fix pass (`46d0461`/`68eb5eb`/`4570c3c`) closed every
gap with real evidence — real `Workflow()` dispatches producing genuine telemetry records
(`dfcc9bb3d6f8`, `aebc3ac4629e`, `8d83a6535dd5`, `1757ae288ffe`, `0c1f697821e4`, `abf30d6ed7e7`), a
real RED/GREEN reuse-terminal write-failure fixture, 5 named milestone-shaped backward-compat
fixtures, plus two coordinator-adjudicated AC-wording revisions (AC11: >=2 real distinct
pre-Receipt sites instead of "each of the 13," on the source-confirmed grounds all 13 share one
`_releaseLeaseAndRecord` implementation; AC2: a narrower transitive-evidence argument for the
`resume` outcome specifically) — closing all 24 AC items.

A second, fully independent, fresh-context re-audit (commit `e30199a`, session `9b3ffa31`)
distrusted the coordinator's own follow-up commits and re-derived every claim from scratch,
including reading the raw `journal.jsonl`/`agent-*.jsonl` files for the cited run IDs directly off
disk (not merely re-trusting the proof document's transcription) and independently re-deriving both
AC-wording revisions as genuinely defensible, not disguised weakenings. **Verdict: NOT-REFUTED** —
all 24 AC items and DoD items 2-5 independently confirmed; DoD item 1 ("Landed on master") correctly
left open for Land. Full report: `milestones/M203/audits/iteration-0-acceptance-audit.md`'s
"## Second-pass adversarial audit" section.

**adversarial-audit disposition: NOT-REFUTED** (final, post-follow-up; see "## Audit disposition
(appended by adversarial acceptance audit, 2026-07-30)" below for the original REFUTED verdict,
preserved as history, not overwritten).

## ABSORB gate run (M203, post-audit)

Re-run live at this Land (2026-07-30):

- `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-126-D
  experiments/quay-perpetual-stream/charters/M203-dir126d-prepare-telemetry.md
  milestones/M203/absorb-entry.md` → **PASS**, all 12 applicable clauses (`clause0-ac-dod-present`:
  "24 checkable clause(s) (checklist-form, 24/24 checked)"), exit 0.
- `bash experiments/quay-perpetual-stream/scripts/task-schema-check.sh tasks/DIR-126-D.md` →
  `PASS: tasks/DIR-126-D.md — schema v1 conformant (kind=milestone-candidate)`, exit 0.
- `npx tsx experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts --task
  tasks/DIR-126-D.md` → `{"ok":true,"code":"wiring-coverage-complete", "findings":[]}`, exit 0.
- `bash experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` → `clean — no un-gitignored
  scratch left in the main tree`, exit 0.
- `bash experiments/quay-perpetual-stream/scripts/worktree-branch-hygiene-check.sh` → `clean — no
  orphaned milestone evidence in un-merged iteration branches` (prunable branches=0, registered
  iteration worktrees=0), exit 0.
- `bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 199
  experiments/quay-perpetual-stream/v-meta-ledger.md` → `PASS: no confirmed-unconsolidated row past
  K without a dated carry-forward` (milestone_counter=199 K=2, both ledger rows `[ok]`).
- `bash plugin/scripts/sync-vendor.sh --check` → `CLEAN: all files verified, no drift detected`
  (17 files, incl. `proposal-convergence.ts`/`milestone-preparation-check.ts`/
  `prepare-admission-check.ts`). `bash plugin/sync.sh` → zero diff on `prepare-milestone.js` itself
  (6 unrelated pre-existing-drift `plugin/gate-scripts/*.sh` files touched by that run were reverted
  via `git checkout -- plugin/gate-scripts/`, same condition the audit already noted, not part of
  this child's diff). `cmp` confirms all 4 touched mirror pairs byte-identical.
- Real test suites, re-run live: `proposal-convergence.test.mjs` 88/88 pass,
  `milestone-preparation-check.test.mjs` 56/56 pass, `prepare-admission-check.test.mjs` 61/61 pass —
  205/205 combined, 0 failures.
- Zero new `Date.now()`/`new Date()`/`import(` regression re-confirmed: `git diff
  5b19f7d..4570c3c -- .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js |
  grep '^+' | grep -E 'Date\.now\(\)|new Date\(|import\('` → zero matches.
- `git status --porcelain` at the start of this Land → clean (no untracked evidence under
  `milestones/M203/audits/`, `milestones/M203/iterations/`, or the charter file — all already
  tracked by the prior commits in this milestone's own chain; `milestones/prepare-telemetry/` does
  not exist as an untracked directory, confirmed via `find`).

**PHI CONSOLIDATION CHECK (M203):** checked — no clearly-applicable prior adaptation was reused
unchanged by this milestone. The `--telemetry`/`checkPreparation()` hash-binding shape mirrors the
existing `--ledger` pattern as a same-domain, same-file structural template (not a V_meta-ledger
cross-domain adaptation, a different axis than this check); neither V_meta ledger row
(`domain-audit-channel≡CI-job`, already `consolidated`; `repo-root isolation-leak lesson`, an
unrelated `.halt`-path/workspace-root failure mode) was reused unchanged here, so no citation
crosses the φ threshold and nothing consolidates into `inherited-core.md` this pass.

## Audit disposition (appended by adversarial acceptance audit, 2026-07-30)

adversarial-audit disposition: REFUTED

V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward (from `vmeta-lag-check.sh --counter 198 experiments/quay-perpetual-stream/v-meta-ledger.md`, milestone_counter=198 K=2; both ledger rows [ok] — "consolidated | lag=- | consolidated — lag gate does not apply | domain-audit-channel≡CI-job pattern (+ per-subcommand audit exercise)" and "proposed | lag=- | proposed — not past φ threshold, no lag gate | repo-root isolation-leak lesson")
