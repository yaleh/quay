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
children: []
extra:
  dirStatus: applied
  schema: v1
---

**type:** execution

## Proposal

Close the real operational-wiring gap that DIR-119-B explicitly deferred to DIR-119-C and that
DIR-119-C's own cold-generation run did not deliver. DIR-119-C proved SELECT-side composite synthesis
works in production (a real `select-preflight.ts` invocation produced this exact composite over real
scored alternatives) and proved atomic Land accounting is correct. It did NOT prove the execution-side
architecture DIR-119's own parent AC #2/#3 and DIR-119-C's own AC #5/#10 require: phase-DAG Build,
read-only audit shards, and a deterministic Reconcile stage that alone owns state mutation. That
architecture still does not exist as literal, callable production code — `composite-build.ts` and
`composite-land.ts` have zero production importers anywhere in the repo, and `composite-audit.ts`/
`composite-reconcile.ts` are only imported by each other, never by `execute-milestone.js`. Build and
Audit are each one monolithic agent call regardless of manifest width; there is no `Reconcile` entry
in `execute-milestone.js`'s `meta.phases`; the single Audit agent directly writes task files,
`dashboard.md`, and the absorb entry (not read-only). Separately, no automated process exists that
converts a SELECT-produced flat `MilestoneCandidate.taskIds` into the manifest's `phases[]`/
`auditShards[]` structure — the only code that builds that shape is
`composite-contracts.ts`'s `makeValidCompositeFixture`, explicitly labeled test-fixture-only; every
real manifest to date (including M-DIR119-C-CANARY's) was hand-authored. A third, independently
discovered defect: the Gate phase's failure branch attributes ANY gate failure — including a single
member task's own `split-or-commit` failure — to `_primaryTaskId` only, with no mechanism to identify
which member actually failed or to land the passing subset.

This directive exists because the independent wiring audit dispatched for DIR-119-C's own Stage 3.4
(session `13efe277-45ff-4563-bcfe-fd2c3db3e2a5`, 2026-07-27/28) did not itself surface the second and
third defects above — it verified journal call-counts, commit atomicity, and AC-citation evidence, but
did not trace production import graphs or exercise the Gate-phase failure branch. Those two defects
were found afterward by direct code reading in the same conversation. This is itself evidence for
DIR-118's premise (an audit can look thorough and still miss real wiring gaps because its checklist
isn't systematic) — DIR-118, if executed, should treat this incident as an additional Finding item.

## Plan

Depends on DIR-119-A, DIR-119-B, and DIR-119-C. Continues the operational-wiring stage
(Phase 3 / Stage 3.4's own carve-out) of
`docs/plans/adaptive-composite-milestone-select-and-execution.md`, closing what that plan's Phase 2
(DIR-119-B) explicitly deferred and Phase 3 (DIR-119-C) did not itself deliver. This child edits the
active execution/audit/Land control plane (`execute-milestone.js`, the `composite-*.ts` modules) and
is human-steered under halt. The resolving milestone must: (1) build the real manifest phase/shard
synthesis step, (2) wire phase-DAG Build + read-only audit shards + a literal Reconcile phase into
`execute-milestone.js`, (3) fix the Gate-phase failure-attribution defect, (4) exercise all of the
above on one real, fresh composite dispatch with RED/GREEN fixture evidence, then (5) obtain a fresh
independent wiring audit explicitly briefed to trace production import graphs and exercise the
Gate-failure branch — the two checks the prior DIR-119-C audit did not perform.

## Finding

Real, code-level evidence gathered 2026-07-27/28 in the session that ran and audited
M-DIR119-C-CANARY:

1. **No manifest phase/shard synthesis.** `grep -n "phases" experiments/quay-perpetual-stream/
   scripts/composite-contracts.ts` shows the only `CompositePhase[]`-producing function is
   `makeValidCompositeFixture(n)`, commented "Used to prove width alone never fails the checker" —
   a test fixture. `select-preflight.ts`'s real, wired `synthesizeCandidatePortfolio()` (via
   `coupling-graph.ts` → `candidate-synthesis.ts` → `portfolio-choice.ts`) produces
   `MilestoneCandidate{candidateId, taskIds, score}` — a flat array, never a phase/shard structure.
2. **The composite execution modules are a self-contained, uncalled island.** Import-graph check:
   `composite-build.ts` — zero importers anywhere. `composite-audit.ts` — imported only by
   `composite-reconcile.ts`. `composite-reconcile.ts` — imported only by `composite-land.ts`.
   `composite-land.ts` — zero importers anywhere. None of the four is imported by
   `execute-milestone.js` or any other production entrypoint. This matches DIR-119-B's own AC/DoD
   text ("tested contract modules referenced by agent-prompt guidance rather than literally invoked
   by the live workflow") and OUTER-LOOP.md's own honest disclosure (line ~106: "conservatively
   single-lead-oriented for THIS first implementation... not self-certified here").
3. **Gate-phase failure attribution is wrong for composite batches.** `.claude/workflows/
   execute-milestone.js`'s Gate phase: `const gatesFailed = gates.filter(Boolean).some(g => !g.ok);
   if (gatesFailed) { await agent(\`Mark task ${_primaryTaskId} needs-human...\`) }`. Regardless of
   which of N member tasks' own `split-or-commit-${tid}` gate actually failed, only
   `_primaryTaskId` is marked `needs-human`; there is no per-task failure identification and no
   partial-Land path for the tasks whose gates passed. This did not trigger during
   M-DIR119-C-CANARY (all 7 gates passed) so the real run never exercised this branch.

## Requested action

1. Add a real, production (not test-fixture-only) manifest-synthesis step that converts a
   SELECT-produced `MilestoneCandidate.taskIds` into a `CompositeManifest{phases[], auditShards[]}` —
   grouping rule must be deterministic and documented (e.g., derived from declared `## Touches`
   disjointness/coupling, not ad hoc human judgment), with a real production callsite between SELECT
   output and `execute-milestone` dispatch.
2. Change `execute-milestone.js`'s composite Build path to literally dispatch one agent per
   manifest `phases[]` entry (respecting `requires` edges): use `parallel()` across phases with no
   dependency relationship, `pipeline()`/serial dispatch across dependent phases, and
   `isolation:'worktree'` only for phases whose `## Touches` overlap (reuse
   `touches-orthogonality-check.ts`, do not reinvent).
3. Change the Audit phase to literally dispatch one agent per declared `auditShardIds` entry,
   each scoped only to that shard's `taskIds`. Wrap every shard dispatch with a mechanical
   `git status --short` snapshot before/after; a non-empty diff hard-fails that shard as a
   read-only-contract violation — do not rely on agent self-discipline.
4. Add a literal `Reconcile` phase to `meta.phases`, placed between Audit and Land, that is the
   ONLY phase permitted to write task AC/DoD ticks, status, dashboard rows, and absorb dispositions;
   wire it to actually invoke `composite-reconcile.ts`'s `reconcile()` (currently reachable only via
   `--selftest`) rather than referencing it as prose guidance.
5. Fix Gate-phase failure handling: when a per-task `split-or-commit-${tid}` gate fails, identify
   and record the SPECIFIC failing task(s) in the needs-human record (not `_primaryTaskId` by
   default). Given `landPolicy:"atomic"`, a single member failure still blocks the whole bundle from
   landing — but the needs-human record must name the true failing task(s), and the record must show
   which members would otherwise have passed.
6. Real regression proof: dispatch one fresh, real composite (2-3 real tasks is sufficient, width 7
   need not be repeated) through the newly wired mechanism. From its real `journal.jsonl`, confirm:
   Build-phase agent-call count equals the manifest's phase count (not 1 for a multi-phase manifest);
   Audit-phase agent-call count equals the shard count, each git-clean before/after; an explicit
   `Reconcile`-phase entry exists between Audit and Land and is the phase whose completion coincides
   with the working tree becoming dirty; Land remains atomic.
7. RED/GREEN fixture evidence (not GREEN-only) for: (a) a hostile audit-shard write being caught by
   the mechanical git-clean check, and (b) a synthetic ≥2-task composite where one member's gate
   fails, proving the needs-human record names that member specifically, not `_primaryTaskId`.
8. Legacy single-task dispatch must remain behavior-identical: width-1 calls should not gain
   unnecessary Reconcile-phase overhead or new failure surface versus the pre-existing path.
9. A fresh independent wiring audit explicitly instructed to (a) trace production import graphs for
   all four composite-*.ts modules and the new manifest-synthesis step, and (b) exercise the
   Gate-phase failure branch — not only read journal call-counts and AC-citation text. This closes
   the meta-gap this directive's own Proposal names.
10. Once (1)-(9) land with real evidence, re-verify DIR-119-C's own AC #5 (phase-DAG Build/read-only
    shards/deterministic Reconcile "using the installed new workflow") and AC #10 (audit immutability,
    reconciler ownership) against the fix; only then may DIR-119-C and DIR-119 be promoted.

## Acceptance Criteria

- [ ] **Most important — real production wiring, not agent-prompt guidance referencing a tested
  module:** for each of `composite-build.ts`, `composite-audit.ts`, `composite-reconcile.ts`,
  `composite-land.ts`, and the new manifest phase/shard synthesis step, a grep/import-graph check
  shows a REAL production callsite from `execute-milestone.js` (both `.claude/workflows/` and
  `plugin/workflows/` mirrors) or its direct call chain — not zero importers, not
  `--selftest`-only reachability. This item alone, if unmet, fails the whole directive regardless of
  how many other items pass.
- [ ] A real composite milestone dispatch's `journal.jsonl` shows Build-phase agent-call count ==
  the manifest's phase count (> 1 for a genuinely multi-phase manifest) — not one monolithic call
  covering all tasks.
- [ ] Same journal shows Audit-phase agent-call count == the manifest's `auditShards[]` count, each
  agent's scope provably limited to that shard's `taskIds` only.
- [ ] A literal `Reconcile` phase entry appears in the journal between the last Audit-shard call and
  Land; git-diff timing evidence shows the working tree stays clean through every Audit-shard call
  and only Reconcile introduces the write-back diff.
- [ ] RED/GREEN evidence for the mechanical git-clean audit-shard check (a hostile shard write is
  caught; a compliant shard passes) — both states shown, not GREEN-only.
- [ ] RED/GREEN evidence for the Gate-failure attribution fix — a synthetic ≥2-task composite with
  one deliberately-failing member's gate produces a needs-human record naming that specific member,
  not `_primaryTaskId` by default.
- [ ] The manifest phase/shard synthesis step is exercised on a REAL SELECT-produced
  `MilestoneCandidate` (not a hand-authored manifest) at least once, with the resulting
  `phases[]`/`auditShards[]` shown to satisfy `composite-preflight.ts`'s existing contract check.
- [ ] Legacy single-task (`{taskId,...}`) dispatch remains behavior-identical: Build/Audit still one
  agent call each; Reconcile phase adds no new failure surface or unnecessary overhead at width 1.
- [ ] A fresh independent wiring audit — explicitly briefed to trace import graphs and exercise the
  Gate-failure branch, not only read journal counts — finds no refutation.
- [ ] DIR-119-C's own AC #5 and #10 are re-confirmed true against this fix by that audit.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code, prompt text, or a same-generation self-test are necessary but insufficient.

- [ ] Landed on `master` under human-steered discipline (this touches
  `.claude/workflows/execute-milestone.js`, the driver execution-chain script).
- [ ] A real, non-fixture composite dispatch exercises the full new wiring end to end with journal
  evidence, not asserted.
- [ ] RED/GREEN evidence exists for both the audit-shard read-only check and the Gate-failure
  attribution fix.
- [ ] A fresh independent wiring audit — briefed on this directive's own Proposal (the prior audit's
  blind spot) — finds zero unresolved findings, with explicit confirmation of production import-graph
  wiring for all four `composite-*.ts` modules plus the new manifest-synthesis step.
- [ ] DIR-119-C's AC #5/#10 and DIR-119's parent AC #2/#3 are re-verified true as a consequence, and
  DIR-119's parent/child lifecycle gate passes only after this child is done.

## Human verification when exp5 marks this DIR done

1. Do `composite-build.ts`, `composite-audit.ts`, `composite-reconcile.ts`, and `composite-land.ts`
   each have a real, non-test, non-selftest production caller now?
2. Does a real composite dispatch's journal show N Build calls and M Audit calls matching the
   manifest, not one monolithic call each?
3. Does a literal Reconcile phase exist and is it the only place that writes task/dashboard/absorb
   state?
4. Was the Gate-failure attribution fix demonstrated with a real failing-member fixture, not just
   read as code?
5. Did the independent audit for this directive explicitly check import graphs and the failure
   branch, rather than repeating the same checklist that missed these defects the first time?

## Touches

- `.claude/workflows/execute-milestone.js`
- `plugin/workflows/execute-milestone.js`
- `experiments/quay-perpetual-stream/scripts/composite-build.ts`
- `experiments/quay-perpetual-stream/scripts/composite-audit.ts`
- `experiments/quay-perpetual-stream/scripts/composite-reconcile.ts`
- `experiments/quay-perpetual-stream/scripts/composite-land.ts`
- `experiments/quay-perpetual-stream/scripts/composite-contracts.ts`
- `experiments/quay-perpetual-stream/scripts/composite-preflight.ts`
- `plugin/scripts/composite-build.ts`
- `plugin/scripts/composite-audit.ts`
- `plugin/scripts/composite-reconcile.ts`
- `plugin/scripts/composite-land.ts`
- `plugin/scripts/composite-contracts.ts`
- `plugin/scripts/composite-preflight.ts`
- `experiments/quay-perpetual-stream/test/composite-*.test.mjs`
- `plugin/test/composite-*.test.mjs`
