---
id: DIR-124-C
title: Extract a deterministic milestone control-plane kernel and narrow Stage
  Adapter ABI from the prompt workflow
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

Replace the live workflow's implicit prompt state machine with an executable transition kernel and
one narrow Stage Adapter ABI. The checked-in workflow becomes a compatibility entry shim that
normalizes invocation, calls the kernel, and returns the kernel result. Prepare, Verify, Build,
Audit, Gate, Reconcile, and Land become explicit adapters consuming [[DIR-124-B]] identity and
receipts.

Reuse [[DIR-119-D]]'s literally wired phase-DAG Build, read-only Audit shards, deterministic
Reconcile, and atomic composite Land. Reuse [[DIR-123]] for all worktree lifecycle operations. Do
not create parallel implementations hidden behind new adapter names.

## Plan

N/A — depends on DIR-124-B. Resolve as a behavior-preserving architectural cutover with golden
replay for singleton and composite paths; policy extraction remains DIR-124-D's scope.

## Finding

The workflow DSL cannot import canonical TypeScript directly, so the current script mirrors
normalization logic inline and uses long prompts to simulate composite Build/Audit/Reconcile/Land
contracts. Even after DIR-119-D wires those mechanisms, orchestration, state transition, effect
authority, and failure routing remain embedded in one provider-specific script.

Merely moving prompt blocks to multiple files would preserve this geometry. The missing boundary is
an executable kernel that owns transitions and rejects adapters that exceed their declared effects.

## Requested action

1. Define an explicit transition table covering Prepared, Verified, Built, Audited, Gated,
   ReadyToLand, Reconciled/Landed, revision-needed, needs-human, halted, retry, and recovery.
2. Define one adapter ABI of the form `run(StageInput) -> StageReceipt`, including declared read,
   write, semantic-resource, and resource-claim sets.
3. Implement adapters for Prepare, Verify, Build, Audit, Gate, Reconcile, and Land around existing
   canonical mechanisms; adapters may not select their successor transition.
4. Make worktree/cwd, RunIdentity, policy reference, validated prior receipts, and granted resources
   explicit inputs—never ambient prompt assumptions.
5. Enforce effects mechanically:
   - Build writes only its candidate worktree;
   - Audit and Gate are read-only except immutable receipt output;
   - Reconcile deterministically proposes authoritative mutations;
   - fenced Land is the only applier to integration/task/ABSORB/dashboard/backlog/counter state.
6. Convert `.claude/workflows/execute-milestone.js` and its plugin mirror into thin compatibility
   shims; eliminate inline mirrors whose canonical implementation is reachable through the kernel.
7. Preserve legacy singleton behavior and DIR-119 composite behavior through DIR-124-A replay.
8. Add invalid-transition, adapter-overwrite, wrong-cwd/worktree, duplicate-Land, and partial-stage
   negative controls.
9. After minimal argument/charter normalization, order the front of Execute as Prepared
   receipt/hash validation, deterministic Verify, then semantic Verify. Prove the reorder against
   DIR-124-A golden replay: valid candidates retain their verdict, while stale/missing receipts
   spend zero Verify agents.
10. Invoke deterministic exit-code/bounded-output checks directly through the kernel adapter rather
    than generic content-agent prompts. Keep semantic/domain judgment in agents and record the two
    classes separately.
11. Apply positive-success transitions to every content-agent stage. Null, undefined, unknown,
    schema-invalid, or missing-required-field results cannot select a successor.
12. Require the Build adapter to return the canonical Build evidence manifest owned by
    [[gap-build-evidence-manifest-missing]] and bind it into the DIR-124-B Build receipt. Audit
    remains independent and verifies the referenced raw artifacts.

## Acceptance Criteria

- [ ] One production kernel owns every milestone transition and has a real call path from both
  checked-in workflow mirrors.
- [ ] Every stage executes through the same typed adapter ABI and emits a DIR-124-B receipt.
- [ ] A stale, missing, or hash-invalid preparation receipt returns before deterministic or
  semantic Verify dispatch; valid singleton and composite replays retain their prior verdicts
  after Prepared is moved.
- [ ] Deterministic checks have direct kernel/adapter callsites with structured output and no
  generic content-agent dispatch; semantic checks remain visibly separate.
- [ ] Every content-agent transition requires a schema-valid accepted success. Null, undefined,
  unknown, and nominal `done` results missing required fields all fail closed before downstream
  dispatch.
- [ ] Build emits a validated, hash-bound Build evidence manifest; Audit consumes it only as an
  evidence index and independently checks raw evidence.
- [ ] Production call-graph evidence shows DIR-119-D composite modules and DIR-123 worktree service
  are invoked through adapters, not duplicated or merely named in prompts.
- [ ] Audit/Gate mutation attempts and Build writes outside the candidate worktree fail
  mechanically.
- [ ] Reconcile is deterministic for identical validated receipts; Land is idempotent and fenced
  against duplicate shared-state application.
- [ ] Invalid transition, wrong worktree/cwd, duplicate Land, and partial-stage fixtures fail closed.
- [ ] Legacy singleton and real composite golden replay preserve intentional behavior and outcomes.
- [ ] The workflow shim contains no canonical argument/state/effect implementation duplicated from
  the kernel; remaining prose is limited to irreducible stage judgment.
- [ ] Task routing, gate lists, test profiles, and resource budgets remain visibly isolated for
  DIR-124-D rather than being silently reimplemented in the kernel.

## Definition of Done

Standard exp5 DoD clauses apply.

- [ ] A real singleton and real composite milestone traverse the installed kernel end to end.
- [ ] Primary-checkout diff snapshots remain clean through Build/Audit/Gate in worktree mode and
  change only at the authorized fenced application boundary.
- [ ] Negative controls prove adapter effect enforcement rather than relying on prompt discipline.
- [ ] Independent wiring audit traces the full production call graph from workflow shim to kernel,
  adapters, DIR-119 modules, worktree service, Reconcile, and Land.

## Human verification when exp5 marks this DIR done

1. Is the workflow now an entry shim rather than the state machine?
2. Can an adapter write outside its declared authority?
3. Is there one production implementation for composite execution and worktree lifecycle?
4. Does the kernel contain execution mechanics but not task-class policy?

## Touches

- `.claude/workflows/execute-milestone.js`
- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/execute-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/*workflow-kernel*`
- `experiments/quay-perpetual-stream/scripts/*stage-adapter*`
- `experiments/quay-perpetual-stream/scripts/composite-*.ts`
- `experiments/quay-perpetual-stream/test/*workflow-kernel*`
- `experiments/quay-perpetual-stream/test/*stage-adapter*`
- `plugin/scripts/*workflow-kernel*`
- `plugin/scripts/*stage-adapter*`
- `plugin/scripts/composite-*.ts`
- `plugin/test/*workflow-kernel*`
- `plugin/test/*stage-adapter*`
