---
id: DIR-124-A
title: Establish milestone-workflow observability, invariant ownership, and
  golden replay before control-plane refactoring
status: todo
labels:
  - directive
  - human-steered
parent: DIR-124
children: []
extra:
  dirStatus: applied
  schema: v1
---

**type:** execution

## Proposal

Create a behavior-preserving measurement and replay boundary for the installed milestone workflow
before [[DIR-123]] and later DIR-124 children change its control plane. Emit structured stage events,
inventory every load-bearing invariant and its intended single owner, and build a replay corpus that
separates intentional compatibility from known defects.

This is C0 of
`docs/proposals/quay-milestone-workflow-git-crystallization.md`. It must observe current behavior
without introducing stage scheduling, new lifecycle policy, or a second journal format that
DIR-124-B later has to preserve.

## Plan

N/A — resolving milestone must produce both measurement code and real baseline artifacts. It is the
first DIR-124 child and depends only on DIR-117 and DIR-119 being complete.

## Finding

Recent workflow repairs have relied on prose histories and manually reconstructed Claude Code
timelines. Current workflow journals are inconsistent or merely mentioned by task acceptance text;
there is no canonical event schema covering queue/start/end time, agent calls, test commands,
working directory, observed effects, and commit identity. Without a before-state replay boundary,
DIR-123 and kernel extraction cannot distinguish a deliberate behavior change from another
accidental capability regression.

Naive golden snapshots are also dangerous: the current workflow contains known defects and stale
claims. A replay corpus must classify each captured behavior as normative, compatibility-only,
observed-but-undesired, or an explicitly open defect.

## Requested action

1. Define a minimal, append-only stage-event schema containing run/candidate/task identity,
   stage/attempt, queued/start/end timestamps, agent-call label, execution cwd/worktree, command/test
   identity, observed writes, base/candidate commit, outcome, and wait reason/resource claim.
2. Instrument Prepare/Verify/Prepared/Build/Audit/Gate/Reconcile/Land boundaries without changing
   their dispatch order, concurrency, lifecycle results, or write authority.
3. Build golden replay cases for legacy singleton success, Verify failure, Prepared failure, Audit
   REFUTED, Gate failure, composite success, concurrent partial survivor, and cache/resume behavior.
4. Record an invariant-ownership manifest. Every entry names one intended executable owner and
   classifies other occurrences as generated view, compatibility adapter, or duplicate to remove.
5. Record the baseline metrics required by DIR-124: stage wall/queue time, prompt bytes, agent-call
   count, full-suite count, shared writer count, observed write sets, Land wait/fence time, and
   replay variance. Split mechanical-runner work from content-agent work and retain agent-minutes,
   token use, finding novelty/recurrence, and artifact bytes/line classes as explanatory
   diagnostics.
6. Add a conformance check comparing workflow metadata and the executable driver contract so stale
   `building`, worktree, gate-count, cache/resume, or phase claims become visible failures.
7. Keep the event schema intentionally minimal and forward-migratable; DIR-124-B owns durable
   RunIdentity/receipt validation and may extend it without preserving accidental diagnostic fields.
8. Add two measured known-defect replay shapes without normalizing them into desired behavior:
   M192's null Build result advancing to Audit/Land is `observed-but-undesired`, and the stale
   M195 Prepared control paying Verify cost before receipt rejection is a compatibility baseline
   for DIR-124-C's later behavior-preserving reorder.
9. Emit a reproducible baseline from first Prepare admission through Execute Land for the available
   real samples, preserving per-stage wall/agent/token cost and terminal outcome. This child records
   the before-state only; it does not infer delivered value or change pass/fail policy.

## Acceptance Criteria

- [ ] One canonical stage-event schema is exercised by real workflow execution and records all
  fields named in Requested action item 1.
- [ ] Instrumentation changes no stage order, agent count, outcome, shared-state mutation, or
  scheduling decision in golden replay.
- [ ] Replay fixtures cover all eight named success/failure/composite/concurrent/cache cases and
  label each assertion as normative, compatibility-only, or known-defect observation.
- [ ] Golden replay includes the M192 null-Build continuation and stale-Prepared-after-Verify
  shapes, classifies both explicitly, and does not make either defect a normative invariant.
- [ ] The invariant-ownership manifest rejects two authoritative executable owners for the same
  rule and identifies every known workflow/OUTER-LOOP/composite duplicate scheduled for deletion.
- [ ] Baseline measurements are emitted mechanically rather than estimated from prose reports.
- [ ] The baseline separates mechanical/content agent calls and reports stage wall/queue time,
  agent-minutes, tokens, finding novelty/recurrence, and artifact-class output from Prepare
  admission through Land where real evidence exists; missing fields are explicit unknowns.
- [ ] A deliberately stale workflow metadata/driver claim fails the conformance check; the corrected
  claim passes.
- [ ] No post-Land Wiring Audit, lifecycle-promotion policy, worktree redesign, stage scheduler, or
  resource lease is introduced by this child.

## Definition of Done

Standard exp5 DoD clauses apply.

- [ ] Landed on master with the canonical test runner green.
- [ ] One real post-landing workflow run emits the installed event schema.
- [ ] Golden replay and metadata conformance include RED/GREEN negative controls.
- [ ] A fresh audit checks that instrumentation did not silently change execution behavior or
  freeze a documented open defect as a normative invariant.

## Human verification when exp5 marks this DIR done

1. Can the before-state of every later DIR-124 refactor be replayed mechanically?
2. Are known defects clearly excluded from the normative compatibility contract?
3. Does the event stream show actual commands/effects rather than agent assertions about them?
4. Is each invariant assigned to one future owner?

## Touches

- `.claude/workflows/execute-milestone.js`
- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/execute-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/*workflow*event*`
- `experiments/quay-perpetual-stream/scripts/*workflow*replay*`
- `experiments/quay-perpetual-stream/fixtures/workflow-replay/*`
- `experiments/quay-perpetual-stream/test/*workflow*replay*`
- `plugin/scripts/*workflow*event*`
- `plugin/scripts/*workflow*replay*`
- `plugin/test/*workflow*replay*`
