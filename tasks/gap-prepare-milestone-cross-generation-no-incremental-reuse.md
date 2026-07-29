---
id: gap-prepare-milestone-cross-generation-no-incremental-reuse
title: prepare-milestone.js's ProposalAuthors phase always independently
  re-derives a Proposal from scratch on every fresh Workflow dispatch —
  DIR-125's bounded-convergence guarantee only covers rounds WITHIN one
  generation, not a redispatch after a prior generation's needs-human/crash, so
  the same format defect can recur across generations without limit
status: done
labels:
  - gap
  - milestone-candidate
  - human-steered
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    gap-prepare-milestone-cross-generation-no-incremental-reuse
    experiments/quay-perpetual-stream/charters/M197-gap-prepare-milestone-resume.md
    milestones/M197/absorb-entry.md
---
## Proposal

Give `prepare-milestone.js` (or its caller) a way to redispatch against a task whose Proposal was
already adjudicated in a prior generation — one that ended in `needs-human`/`split-recommended` or
crashed mid-run — without re-running `ProposalAuthors`/`Adjudicate` from a blank slate. The new
dispatch should start from the already-adjudicated Proposal (plus any fixes already applied to it)
and re-enter at `ProposalReview`, not re-derive the Proposal independently again.

## Finding

Discovered 2026-07-28/29 during three consecutive real `prepare-milestone.js` dispatches for
`DIR-119-D` (M196), each launched via a fresh `Workflow({scriptPath: ...})` call (never `resume`,
per this repo's own M144 rule — external state, i.e. the task body, had changed between rounds):

1. **Round 1** crashed mid-run (agent stalled 6× on all attempts, an infrastructure fault, not a
   content failure). Its `Adjudicate` phase's `task_write` side effect had already landed before
   the crash, leaving a freshly re-derived Proposal on disk. That Proposal's `## Acceptance
   Criteria` list block had no blank lines between the `- **W1** ... - **W13**` bullets, so
   `wiring-coverage-check.ts`'s sentence splitter (which only splits on `\n{2,}` or
   period-plus-whitespace-plus-capital, never on a bare bullet-list newline) merged 10 of 11
   claims into ones with no matching AC item.
2. **Round 2** was manually repaired (paragraph-split the merged list, added matching AC items,
   `wiring-coverage-complete`), committed, then redispatched fresh (round 1's crash meant no valid
   run existed to resume from). Round 2's own `ProposalAuthors`/`Adjudicate` — three fresh authors,
   re-deriving independently per `prepare-milestone.js` line 45's explicit instruction ("ground
   your Proposal in the actual current repository state, **not in the existing task body's
   possibly-thin Proposal**") — overwrote the manually repaired Proposal with a brand-new one that
   had the SAME class of defect (un-blank-lined `## Mechanism-claim wiring ledger` bullets, 10 of
   11 claims uncovered) plus a NEW factual error ("both `select-preflight.js` wrappers", when only
   one such file exists in the repo).
3. **Round 3** was manually repaired again (same fix pattern), committed, then redispatched fresh
   for the same reason. Round 3's fresh re-derivation again produced `split-recommended` with 26
   blocking findings — again the same root cause (un-blank-lined `Key design decisions`/`Risks and
   mitigations`/`Acceptance-criteria coverage`/`Alternatives considered`/`Mechanism-claim wiring
   ledger` list blocks), plus one new factual line-number citation error and a static-check gap in
   the Reconcile-sole-writer claim.
4. **`tasks/DIR-125.md`'s own text is explicit that this is a within-generation guarantee only**:
   "Proposal authors and adjudicator run once **per generation**; subsequent rounds use a focused
   reviser and independent delta reviewer" (Requested action item 1) and "the production workflow
   cannot perform more than one full Proposal synthesis per generation without an explicit
   scope/generation reset" (DoD clause, `fullSynthesisCount > 1` fails closed **within one
   receipt**). DIR-125 never claims a NEW generation (a fresh `Workflow` dispatch, especially after
   a crash or `needs-human` from a prior generation) reuses or incrementally revises a prior
   generation's adjudicated Proposal — and the code matches this reading:
   `.claude/workflows/prepare-milestone.js`'s `ProposalAuthors` phase has no parameter or code path
   that accepts a "start from this existing Proposal" input; every dispatch — cold or warm — always
   runs N independent authors against `task_get` and the charter file only.
5. This is real, generalizable, and cheap to reproduce: `git log`'s three DIR-119-D-adjudication
   commits (round 2's `9f4a80f`, round 3's `836fe9e`, plus the pre-round-1 charter/task commits) are
   durable evidence that the exact same class of mechanical defect recurred three times in the same
   session against the same task, purely because each fresh dispatch discarded the previous round's
   manually-verified fix.
6. Consequence for cost/throughput: DIR-125's own recorded M192/DIR-120 baseline was ~3h15m /
   ~1.13M output tokens for 10 *within-generation* full-regeneration rounds — the defect DIR-125 was
   built to close. This gap's three *cross-generation* redispatches for DIR-119-D consumed a
   comparable order of magnitude (three full `ProposalAuthors`+`Adjudicate`+`ProposalReview` runs,
   ~1.6M+ subagent tokens combined) for a structurally identical reason: no mechanism exists to
   avoid re-deriving a Proposal a prior generation already fixed.

## Plan

`docs/plans/M197-gap-prepare-milestone-resume.md` (this milestone's own hand-authored Plan — per
human-steered decision, dispatched directly via `execute-milestone.js` without a
`prepare-milestone.js` run; ordinary `prepare-milestone` dispatch would ironically retrigger the
exact cross-generation problem this task exists to fix).

## Requested action

1. Add an explicit "resume from adjudicated Proposal" input to `prepare-milestone.js` (both
   mirrors) — e.g. an optional `$a.resumeFromAdjudicatedProposal: true` flag, or detect that the
   task's `## Proposal` already carries a `wiring-coverage-complete` verdict against its own `##
   Acceptance Criteria` and the caller explicitly opts in — that skips `ProposalAuthors`/
   `Adjudicate` entirely and enters directly at `ProposalReview` using the task's CURRENT `##
   Proposal` as-is.
2. Document the caller contract in `OUTER-LOOP.md` and this skill's own guidance: after a
   `prepare-milestone` dispatch ends in `needs-human`/crash and a human (or an agent under
   human-steered discipline) manually fixes the on-disk Proposal to resolve the findings, the NEXT
   dispatch should pass the new resume flag rather than a bare fresh call — mirroring the existing
   `resumeFromRunId` guidance for `Workflow` itself (CLAUDE.md's M144 rule), but at the
   `prepare-milestone` domain-semantic level, not the underlying `Workflow` engine's cache level.
3. Keep `fullSynthesisCount`'s existing meaning (count of times `ProposalAuthors`+`Adjudicate` ran)
   accurate under the new path: a resumed dispatch that skips those phases must record
   `fullSynthesisCount: 0` for its own run, distinct from a cold dispatch's `fullSynthesisCount: 1`,
   so `validateConvergenceCounters`'s existing `fullSynthesisCount > 1` fail-closed check is not
   silently defeated or misapplied across the resume boundary.
4. Add a RED/GREEN fixture: RED — a fresh cold dispatch against a task whose Proposal already has
   zero wiring-coverage findings still re-derives from scratch (today's behavior, wasteful but not
   wrong); GREEN — the same task dispatched with the new resume flag reaches `ProposalReview`
   without any `ProposalAuthors`/`Adjudicate` agent call in its journal.
5. Do NOT weaken DIR-125's own within-generation guarantee (`fullSynthesisCount <= 1` per receipt)
   to achieve this — the fix is a caller-facing skip path for genuinely re-derived-and-fixed
   content, not a loosening of the bounded-convergence loop itself.

## Acceptance Criteria
- [x] **RESOLVED post-audit (coordinator-dispatched real journal, 2026-07-29):**
  `prepare-milestone.js` (both `.claude/workflows/` and `plugin/workflows/` mirrors,
  byte-identical) accepts an explicit resume-from-adjudicated-Proposal input and, when supplied,
  its journal shows ZERO `proposal-author-*`/`adjudicate` agent dispatches. A real
  `Workflow({scriptPath: ...})` dispatch (run `wf_2cc60d00-181`, args
  `{resumeFromAdjudicatedProposal: true, taskId: FIXTURE-M197-RESUME-PROOF, ...}`) produced a real
  `journal.jsonl` (12 entries, 6 agent dispatches) whose results are exclusively
  `ProposalReview`/revise-shaped — zero `authorIdx`-shaped or bare-adjudicator-shaped results. Full
  evidence: `milestones/M197/resume-flag-real-journal-proof.md`.
- [x] **RESOLVED post-audit (coordinator-dispatched real journal, 2026-07-29):** A cold
  (non-resumed) dispatch's behavior is completely unchanged. The M196/DIR-119-D cold dispatch
  `wf_9aea9c8c-fc7` (no `resumeFromAdjudicatedProposal`, predates this task's own Build) shows real
  `authorIdx: 1` and `authorIdx: 2` results — the existing N-author dispatch shape, unchanged by
  this Build (the resume code path is additive and gated on the new flag being explicitly `true`).
- [x] `fullSynthesisCount` is `0` for a resumed run and `1` for a cold run, and
  `validateConvergenceCounters`'s existing fail-closed check is confirmed to still reject
  `fullSynthesisCount > 1` regardless of which path produced the receipt. Confirmed:
  `node --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` → 34/34 pass,
  incl. "fullSynthesisCount=0 ... ok, same as fullSynthesisCount=1" and "fullSynthesisCount > 1
  fails closed regardless of which path (cold or resumed) produced the receipt" (audit re-ran this
  command directly, real output).
- [x] RED/GREEN fixture evidence for both the cold-dispatch-always-rederives (RED, current/prior
  behavior) and resume-flag-skips-rederivation (GREEN, new behavior) cases. Confirmed:
  `node --test plugin/test/prepare-milestone-convergence.test.mjs` → 26/26 pass, incl. "M197 RED:
  cold dispatch ... always re-derives" and "M197 GREEN: resumeFromAdjudicatedProposal:true skips
  ProposalAuthors/Adjudicate" for both mirrors (audit re-ran this command directly, real output).
- [x] `OUTER-LOOP.md` and the `quay-task-to-plan`/preparation-related skill docs are updated to
  instruct: after a `needs-human`/crashed `prepare-milestone` dispatch is manually repaired on
  disk, the next dispatch should use the resume flag, not a bare fresh call. Confirmed: `grep -n
  resumeFromAdjudicatedProposal experiments/quay-perpetual-stream/OUTER-LOOP.md` → 2 hits (RESUME
  CONTRACT clause under `prepare(c)`); `.claude/skills/quay-task-to-plan/SKILL.md` and
  `plugin/skills/quay-task-to-plan/SKILL.md` both carry an identical new bullet under contract 4
  (audit diffed both mirrors — byte-identical).
- [x] **RESOLVED post-audit (coordinator-dispatched real journal, 2026-07-29), scope-corrected:**
  a real dispatch with `resumeFromAdjudicatedProposal: true` (`wf_2cc60d00-181`) confirms
  `ProposalAuthors`/`Adjudicate` are skipped and the run enters directly at `ProposalReview`. The
  run itself ended `needs-human`/`split-recommended` after 1 full review + 2 delta rounds (the
  split checkpoint fired at the top of what would have been round 3, before any round-3 agent was
  dispatched — independently re-counted from the raw journal by the M197 re-audit) — a
  legitimate bounded-convergence termination caused by real, honestly-disclosed defects in the
  disposable scratch fixture's own body (a byte-identical copy of this task, so its own
  `## Acceptance Criteria`/`extra.acceptance` self-referenced a different task id, and its
  Proposal went stale mid-review as the very mechanism it described landed on master) — NOT a
  defect in the resume mechanism being proven, which is independent of the reviewed content's own
  quality. Full evidence: `milestones/M197/resume-flag-real-journal-proof.md`.
- [x] **RESOLVED post-audit (coordinator-dispatched real journal, 2026-07-29):**
  **Resume-flag callsite is real, non-selftest (wiring):** verified via source read + real
  journal — `prepare-milestone.js` (both mirrors) checks `$a.resumeFromAdjudicatedProposal: true`
  before dispatching any `ProposalAuthors`/`Adjudicate` agent; when true, the workflow skips
  straight to `ProposalReview` — confirmed by real dispatch `wf_2cc60d00-181`'s journal containing
  zero `ProposalAuthors`/`Adjudicate` agent-call entries (source-read half was already CONFIRMED
  by the M197 audit; this closes the journal half).
- [x] **OUTER-LOOP caller-contract update is real (wiring):** verified via grep of `OUTER-LOOP.md`
  — its `prepare(c)` step text names the `resumeFromRunId`/`Workflow`-level distinction from
  CLAUDE.md's M144 rule and explicitly instructs that after a `prepare-milestone` dispatch ends
  `needs-human` (or crashes) and a human/agent manually repairs the on-disk Proposal, the NEXT
  dispatch passes `resumeFromAdjudicatedProposal` rather than a bare fresh call. Confirmed: audit
  read `experiments/quay-perpetual-stream/OUTER-LOOP.md` lines 68-83 directly — "RESUME CONTRACT
  (M197/...)" clause present with exactly this content.
- [x] **`fullSynthesisCount` semantics hold across the resume boundary (wiring):** verified via
  unit test — a resumed dispatch's receipt records `fullSynthesisCount: 0` (no
  `ProposalAuthors`/`Adjudicate` ran), a cold dispatch's receipt records `fullSynthesisCount: 1`,
  and `validateConvergenceCounters`'s existing `fullSynthesisCount > 1` fail-closed check is
  confirmed, by a real fixture, to still reject a receipt claiming more than one full synthesis
  regardless of which path (cold or resumed) produced it. Confirmed via the same 34/34
  proposal-convergence.test.mjs run cited above (this bullet's own text says "verified via unit
  test", a lower bar than the journal-requiring bullets, and that bar is met).
- [x] **RESOLVED post-audit (coordinator-dispatched real journal, 2026-07-29):**
  **Resume path never re-derives (wiring):** verified from real journal `wf_2cc60d00-181` — no
  `ProposalAuthors`/`Adjudicate` agent call appears anywhere in the journal (6/6 dispatches are
  ProposalReview/revise-shaped). Byte-identical Proposal preservation into the review phase is
  additionally confirmed by the same run's ProposalReview findings quoting/critiquing the
  fixture's PRE-EXISTING (pre-dispatch) Proposal text verbatim, not a freshly-authored one.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code and prose claims alone are necessary but insufficient — real command output
is required for every item above.

- [x] **Landed on `master` under human-steered discipline** (touches
  `.claude/workflows/prepare-milestone.js`, a driver execution-chain script). Build commit
  (`528a26a`) landed directly on `master` (this repo runs directly on `master`, no feature
  branch); the Land/ABSORB commit series (`milestone_counter 194→195`) completes this milestone's
  close-out — mechanical gate `it0-dod-check.sh` exit 0 (12/12 clauses), `vmeta-lag-check.sh
  --counter 193` PASS, `tree-hygiene-check.sh`/`worktree-branch-hygiene-check.sh` both clean,
  `it0-split-or-commit-check.sh .` PASS (474 tasks) — all independently re-run at Land.
- [x] **RESOLVED post-audit (coordinator-dispatched real journal, 2026-07-29):** Real journal
  evidence for both the cold and resumed dispatch paths — see AC 1/2/6/7/10 above and
  `milestones/M197/resume-flag-real-journal-proof.md`.
- [x] DIR-125's own `fullSynthesisCount <= 1`-per-receipt guarantee is confirmed unweakened by a
  real fixture attempting to abuse the resume path to bypass it. Confirmed:
  `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` test "fullSynthesisCount >
  1 fails closed regardless of which path (cold or resumed) produced the receipt — resume
  introduces no new exemption" passes (part of the 34/34 real run cited above).

## Human verification when exp5 marks this task done
1. Can a human-repaired Proposal survive a redispatch of `prepare-milestone` without being
   silently discarded and re-derived from scratch?
2. Does the existing within-generation `fullSynthesisCount <= 1` guarantee still hold under the
   new resume path?
3. Is the caller contract (when to use the resume flag) documented somewhere an operator would
   actually see it, not only in this task's own body?

## Touches

- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts
- plugin/scripts/milestone-preparation-check.ts
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- plugin/test/prepare-milestone-convergence.test.mjs
- experiments/quay-perpetual-stream/OUTER-LOOP.md

## Execution record

- **Milestone:** M197
- **Iteration count:** 1 (direct-to-master, no separate worktree/branch)
- **Realized Δv:** 0 (v̂>0, capabilityGrowth, deliverable, method-infra surface — no chart-2
  `packages/quay*` surface cell moves; the VT ruler cannot score `prepare-milestone` pipeline
  capability, structurally identical to the M164/M167/M179/M188/M189/M192/M193/M194/M195
  precedent)
- **Merge commit SHA:** bb9458b
- **Audit disposition:** NO REFUTATION FOUND (three successive independent adversarial acceptance
  audit passes, all session `ef014e6f-7f2a-4c7a-a7ce-a2c6f5e5ab78` — pass 1 REFUTED on the
  "real journal" evidentiary bar for 5 AC + 1 DoD item, closed by a real
  `resumeFromAdjudicatedProposal:true` `Workflow` dispatch producing journal `wf_2cc60d00-181`
  plus cold-path contrast `wf_9aea9c8c-fc7`; pass 2 independently re-derived and confirmed the fix
  genuine; pass 3, a fresh-context re-audit with no prior chat history, re-opened the raw journal
  files directly and found no refutation on any item)
- **One-line outcome summary:** `prepare-milestone.js` gained a `resumeFromAdjudicatedProposal`
  input (both mirrors) that skips `ProposalAuthors`/`Adjudicate` on redispatch and re-enters at
  `ProposalReview` using the already-adjudicated Proposal, closing the real cross-generation
  non-reuse defect discovered during DIR-119-D/M196; landed on `master`, all 10 AC + 3 DoD items
  independently confirmed true.
