---
id: DIR-119-D
title: Literally wire phase-DAG Build, read-only audit shards, and deterministic
  Reconcile into execute-milestone.js; add real manifest phase/shard synthesis;
  fix Gate-failure task attribution
status: todo
labels:
  - milestone-candidate
  - human-steered
parent: DIR-119
children:
  - DIR-119-D1
  - DIR-119-D2
  - DIR-119-D3
  - DIR-119-D4
  - DIR-119-D5
extra:
  dirStatus: applied
  schema: v1
---
**type:** execution

## Proposal

Close, as literal callable production code, the execution-side gaps that DIR-119-B deliberately
left as tested-but-uninvoked contract modules and that DIR-119-C's real canary run neither
delivered nor (in its independent audit) checked for. **Split 2026-07-29 (DIR-026
SPLIT-OR-COMMIT)**, after a real `prepare-milestone.js` `ProposalReview` run against this task's
own (already wiring-coverage-complete, schema-passing) Proposal returned
`needs-human`/`split-recommended` with code `split-multi-mechanism` ("candidate contains 5
independently landable mechanisms (> 2)") — a real, mechanically-detected structural finding, not
an infrastructure fault (the same run also caught 3 genuine content defects in this task's own
prior text: a self-contradicting `select-preflight.js` "both wrappers" AC item, a missing
`## Touches` entry for the file the Proposal itself said it would edit, and a stale
`## Requested action` block written before the reconciled Proposal's actual fusion-not-isolation
mechanism existed).

Parent completion is exactly the completion of DIR-119-D1 through DIR-119-D5, in that dependency
order:

1. [[DIR-119-D1]] — real manifest phase/shard synthesis (`composite-manifest-synthesis.ts`) at the
   SELECT/dispatch boundary. No dependencies within this split.
2. [[DIR-119-D2]] — Build becomes a real phase-DAG dispatcher (`composite-build.ts`). Depends on D1.
3. [[DIR-119-D3]] — Audit becomes per-shard, mechanically-enforced read-only dispatch
   (`composite-audit.ts`). Depends on D1, D2.
4. [[DIR-119-D4]] — literal Reconcile phase as sole composite state writer, plus the Gate-failure
   attribution fix (`composite-reconcile.ts`). Depends on D1, D2, D3.
5. [[DIR-119-D5]] — Land as an atomic transaction validator (`composite-land.ts`), the single real
   end-to-end pipeline proof, and the fresh independent wiring audit DIR-119-D's own Requested
   action item 9 requires. Depends on D1 through D4 all being `done`.

This parent is not independently SELECTable — each child carries its own full Proposal/Plan/AC/DoD
and is dispatched (prepared + executed) on its own.

## Plan

N/A — parent directive resolved only through its ordered children. Parent completion is exactly
the completion of DIR-119-D1 through DIR-119-D5 in the dependency order stated above; the parent
is not independently SELECTable.

## Finding

Real, code-level evidence gathered 2026-07-27/28/29 in the sessions that ran and audited
M-DIR119-C-CANARY and then re-derived this task's own Proposal through a real `prepare-milestone.js`
dispatch:

1. **No manifest phase/shard synthesis.** `grep -n "phases" experiments/quay-perpetual-stream/
   scripts/composite-contracts.ts` shows the only `CompositePhase[]`-producing function is
   `makeValidCompositeFixture(n)`, a test fixture. `select-preflight.ts`'s real, wired
   `synthesizeCandidatePortfolio()` produces `MilestoneCandidate{candidateId, taskIds, score}` — a
   flat array, never a phase/shard structure. Closed by [[DIR-119-D1]].
2. **The composite execution modules are a self-contained, uncalled island.** Import-graph check:
   `composite-build.ts` — zero importers anywhere. `composite-audit.ts` — imported only by
   `composite-reconcile.ts`, and that import is TYPE-ONLY (erased at compile/strip time — zero
   runtime connection). `composite-reconcile.ts` — imported only by `composite-land.ts`, also
   type-only. `composite-land.ts` — zero importers anywhere. None of the four is imported by
   `execute-milestone.js` or any other production entrypoint. Closed by [[DIR-119-D2]] (Build),
   [[DIR-119-D3]] (Audit), [[DIR-119-D4]] (Reconcile), [[DIR-119-D5]] (Land).
3. **Gate-phase failure attribution is wrong for composite batches.** `.claude/workflows/
   execute-milestone.js`'s Gate phase discards which of N member tasks' own
   `split-or-commit-${tid}` gate actually failed and always names only `_primaryTaskId`. This did
   not trigger during M-DIR119-C-CANARY (all 7 gates passed) so the real run never exercised this
   branch. Closed by [[DIR-119-D4]].
4. **This directive exists because the independent wiring audit dispatched for DIR-119-C's own
   Stage 3.4 verified journal call-counts and AC-citation evidence but did NOT trace production
   import graphs or exercise the Gate-phase failure branch** — the meta-gap every child's own AC
   requires its own fresh independent audit to close, and [[DIR-119-D5]]'s final integration audit
   closes for the whole pipeline.
5. **This task's own split.** A real `prepare-milestone.js` dispatch with
   `resumeFromAdjudicatedProposal: true` (proving the cross-generation resume mechanism landed by
   `gap-prepare-milestone-cross-generation-no-incremental-reuse`/M197 works in real production use)
   against this task's then-current, already `wiring-coverage-complete: 28/28` Proposal returned
   `needs-human`/`split-recommended`, code `split-multi-mechanism`, reason "candidate contains 5
   independently landable mechanisms (> 2)". The same review pass also found 3 real, previously
   undetected content defects (see Proposal above) — confirming a real independent review, not a
   rubber stamp, ran against this task's content even though it entered directly at
   `ProposalReview` (zero `ProposalAuthors`/`Adjudicate` dispatches in that run's journal).

## Requested action

1. Execute DIR-119-D1 through DIR-119-D5 in their stated dependency order — each is independently
   `prepare-milestone.js` + `execute-milestone.js` dispatched, with its own real proof and
   independent audit.
2. Do not promote DIR-119-D itself to `done` until all five children are `done` AND DIR-119-D5's own
   final integration audit (tracing all five `composite-*.ts` modules together, in one real
   end-to-end dispatch) finds no refutation.
3. Once DIR-119-D is `done`, re-verify DIR-119-C's own AC #5/#10 and DIR-119's parent AC #2/#3 in a
   separate re-adjudication step (tracked as its own task, not self-certified by any DIR-119-D
   child).

## Acceptance Criteria

- [ ] DIR-119-D1 is `done`, real-landed, and independently audited (manifest synthesis has a real
  production callsite; a real SELECT-produced candidate with disjoint Touches synthesizes more than
  one phase).
- [ ] DIR-119-D2 is `done`, real-landed, and independently audited (Build dispatches one real agent
  per manifest phase, journal-count-confirmed).
- [ ] DIR-119-D3 is `done`, real-landed, and independently audited (Audit dispatches one real agent
  per shard, mechanically read-only-enforced, RED/GREEN hostile-write evidence).
- [ ] DIR-119-D4 is `done`, real-landed, and independently audited (literal Reconcile phase is the
  sole composite writer; Gate-failure attribution names the real failing member, RED/GREEN
  evidence).
- [ ] DIR-119-D5 is `done`, real-landed, and independently audited (Land is an atomic transaction
  validator; ONE real end-to-end dispatch exercises the full five-mechanism chain; the final
  independent audit traces all five modules' import graphs and exercises the Gate-failure branch).
- [ ] Parent/child lifecycle consistency gate (`split-or-commit`) passes: this parent is `done` iff
  all five children are `done` — no PARENT-DONE-IFF-CHILDREN violation at any point during the
  split's execution.
- [ ] DIR-119-C's own AC #5 and #10, and DIR-119's parent AC #2/#3, are re-confirmed true as a
  consequence, in a separate re-adjudication step.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code, prompt text, or a same-generation self-test are necessary but insufficient.

- [ ] Every child named in Acceptance Criteria has real execution evidence (real journals, real
  independent audits), not same-generation assertion.
- [ ] `it0-split-or-commit-check.ts .` (whole-store scan) reports no PARENT-DONE-IFF-CHILDREN
  violation for this parent/children set, checked before this parent is marked `done`.
- [ ] The final (DIR-119-D5) independent wiring audit traces production import graphs across all
  five `composite-*.ts` modules together and exercises the Gate-failure branch, rather than
  accepting five separately-scoped audits' prose claims as sufficient for the integrated whole.
- [ ] DIR-119-C's AC #5/#10 and DIR-119's parent AC #2/#3 are re-verified true as a consequence, and
  DIR-119's own parent/child lifecycle gate passes only after this task is done.

## Human verification when exp5 marks this DIR done

1. Are all five children (DIR-119-D1 through D5) real-landed and independently audited, in their
   declared dependency order?
2. Does DIR-119-D5's own final audit trace the FULL five-module chain in one real end-to-end
   dispatch, not five disconnected partial proofs?
3. Is DIR-119-C's own AC #5/#10 re-confirmed true against the fully-integrated fix, not merely
   against one child's isolated scope?
4. Was this parent kept `todo` throughout children's execution, only promoted to `done` after ALL
   five are done and the split-or-commit gate passes?

## Touches

- `tasks/DIR-119-D1.md`
- `tasks/DIR-119-D2.md`
- `tasks/DIR-119-D3.md`
- `tasks/DIR-119-D4.md`
- `tasks/DIR-119-D5.md`
