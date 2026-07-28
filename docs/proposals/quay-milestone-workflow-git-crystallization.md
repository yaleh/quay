# Proposal — Crystallizing the milestone workflow with geometric information theory

- **Status:** proposal / architecture discussion only
- **Date:** 2026-07-28
- **Scope:** converge the live milestone workflow from prompt-coupled orchestration
  into a small executable control-plane kernel with narrow stage interfaces.
  This document does not change the active loop, create an implementation
  directive, or authorize a runtime-generation upgrade.
- **Evidence base:** the live workflow and driver, Git history from the initial
  OUTER-LOOP-to-workflow migration through M191, recent Claude Code session
  history queried with meta-cc, and the M185–M189 build-time and capability
  regression analysis.
- **Related:**
  [`exp5-crystallization-strategy.md`](./exp5-crystallization-strategy.md)
  defines the broader subtractive/executable crystallization discipline. ·
  [`quay-milestone-workflow-stage-pipelining-and-leases.md`](./quay-milestone-workflow-stage-pipelining-and-leases.md)
  defines the eventual cross-milestone stage pipeline and concurrency model. ·
  [`milestone-workflow-performance-and-capability-regression-analysis.md`](../milestone-workflow-performance-and-capability-regression-analysis.md)
  records the workflow regressions and M185–M189 timing evidence. ·
  `DIR-123`, `DIR-119-D`, and `DIR-118` own major implementation nuclei:
  worktree isolation, literal composite execution/read-only audit/Reconcile,
  and post-Land wiring receipts respectively.

## 1. Decision summary

The milestone workflow has crossed the transition at which further feature
expansion costs more than convergence. The immediate architectural priority
should be to crystallize four boundaries, in this order:

1. **worktree boundary** — physical isolation of candidate state;
2. **receipt boundary** — immutable, hash-bound information transfer;
3. **Reconcile/Land boundary** — one owner for shared-state mutation; and
4. **policy boundary** — task routing and required verification represented as
   versioned data rather than embedded prompt branches.

The desired control flow is:

```text
task / Proposal / Plan / policy judgment
                    │
                    ▼
          Policy Registry + StageSpec
                    │
                    ▼
 RunIdentity / state machine / worktree / resource kernel
                    │
             immutable receipts
                    ▼
     Prepare → Verify → Build → Audit → Gate
                    │
                    ▼
          deterministic Reconcile
                    │
                    ▼
              fenced Land
```

This is deliberately not a proposal to split one 490-line file into several
files. A successful split removes duplicated knowledge, narrows effects, gives
each interface one owner, and makes violations mechanically rejectable.

## 2. Geometric-information-theory framing

Geometric information theory (GIT) is used here as an operational vocabulary,
not as a claim of precise continuous mathematics. For a milestone execution,
write the effective description burden as:

```text
L(X) = L(G) + L(R | G)
```

where:

- `G` is the persistent workflow graph: orchestration, rules, schemas, tools,
  prompts, compatibility logic, and state transitions; and
- `R | G` is the per-run residual context an agent must reload, infer, or
  reconstruct because `G` did not make an interface executable.

The present workflow has high values on both terms. Its fixed orchestration is
large, while every repair still requires broad task/charter/driver/history/Git
context. The system is therefore not merely large; it has too many independent
free variables at stage boundaries.

This proposal uses five practical closure dimensions:

- **`L_T`, target closure:** a local test or contract module being green does
  not prove that the installed workflow invokes it.
- **`L_C`, contract closure:** many load-bearing interfaces are prose promises
  rather than schemas with executable preconditions and effects.
- **`L_D`, descriptive duplication:** mechanical operations are repeated in
  prompts, OUTER-LOOP, tasks, and scripts.
- **`L_G`, graph/abstraction burden:** the live prompt workflow and the newer
  composite modules describe overlapping but different execution graphs.
- **`L_S`, instability:** equivalent runs may choose different paths, tests,
  Git operations, evidence roots, and write timing.

The convergence objective is to reduce these dimensions together. Improving
only one can make another worse; for example, adding typed modules without
wiring and deleting their prompt duplicates increases `L_G`.

## 3. Evidence that the workflow is molten

### 3.1 One live entry point owns too many change axes

At the time of this investigation:

- `.claude/workflows/execute-milestone.js` is approximately 490 lines / 38 KB;
- `.claude/workflows/prepare-milestone.js` is approximately 195 lines / 14 KB;
- `OUTER-LOOP.md` is approximately 299 lines / 22 KB.

`execute-milestone.js` simultaneously owns:

- legacy and composite argument normalization;
- task/class policy routing;
- Verify check selection and its incomplete cache protocol;
- Prepared receipt validation;
- Build method, test, evidence, and commit instructions;
- Audit judgment plus task, ABSORB, dashboard, and Git-index writes;
- Gate selection and failure-state mutation;
- serial and concurrent Land behavior;
- worktree/branch/merge compatibility text;
- task lifecycle, dashboard, backlog, and counter updates; and
- compatibility with old caller and result shapes.

These are independent architectural dimensions. A local edit in the file can
therefore deform policy, state, Git visibility, evidence provenance, and
concurrency at once.

### 3.2 Declared and executed geometries have drifted

The live descriptions still contain claims that no longer match the execution
path:

- workflow metadata describes a possible `building` result and background
  dispatch, while Build now executes synchronously;
- OUTER-LOOP describes an isolated Build worktree although commit `4191a31`
  removed the workflow's `isolation: 'worktree'`;
- OUTER-LOOP describes seven in-workflow absorb gates, while several were
  removed or relocated;
- phases are described as cached/resumable, but Verify cache state is returned
  to a caller that does not persist and supply it in current observed runs;
- Land still instructs an agent to merge an iteration worktree even on the
  live no-worktree path.

This drift is not documentation polish. Agents execute these descriptions, so
stale prose is an active control-plane defect.

### 3.3 Prompt-as-code creates high instability

Mechanical behavior currently remains open to agent interpretation:

- whether and where to create a worktree;
- which milestone-root convention to use for iteration evidence;
- which test entry point is canonical and how often to run it;
- when to stage and commit;
- how to recover from a partial Git operation;
- which lifecycle and shared-state files an observational phase may modify.

These are not useful degrees of freedom. They increase `L_S` without increasing
the system's problem-solving capacity.

### 3.4 Audit mixes observation and mutation

The Audit prompt is nominally fresh-context and adversarial, but also directs
the auditor to:

- tick task AC/DoD checkboxes;
- append the audit disposition to ABSORB;
- write dashboard deviation rows;
- create and stage the audit artifact.

Gate failure handling can also trigger task/ABSORB mutation. Consequently,
Audit and Gate are not clean read-only stages and cannot be freely parallelized
or replayed. Auditor independence is weakened because the observer also changes
the object and record it grades.

### 3.5 A shadow architecture exists beside the live architecture

The repository already contains typed modules for:

- composite argument normalization and contracts;
- phase-DAG Build planning and evidence mapping;
- read-only audit shards and verdict combination;
- deterministic reconciliation; and
- atomic Land accounting.

Together the core `composite-build/audit/reconcile/land/contracts` modules are
roughly 1,460 lines. The live workflow literally invokes
`composite-preflight.ts`, but otherwise refers to these modules mainly as
instructions inside Build/Audit/Land prompts.

The result is a dual geometry:

```text
actual control plane:  execute-milestone prompt monolith
target control plane:  composite typed modules and contracts
```

Until the target modules become the execution mechanism and their duplicate
prompt semantics are removed, they add a second representation rather than
compressing the first.

### 3.6 History and session access show high propagation

The regression sequence is consistent with the structural diagnosis:

- the first workflow migration omitted earlier invariants;
- restoring some invariants was followed by synchronous Build, which removed
  class routing, mandatory Proposal→Plan, dual iteration, TDD thresholds, and
  termination conditions;
- worktree isolation was removed so a later Audit could see Build changes;
- acceptance/implementation/audit gates were removed while fan-in relocation
  remained incomplete;
- Verify caching was implemented locally but not closed through its caller;
- composite execution modules were added without literal Build/Audit/Reconcile/
  Land wiring.

In the meta-cc index, `execute-milestone.js` appeared in four recent Claude Code
sessions with 14 reads and seven edits. Its co-access set spans driver,
dashboard, task, charter, audit, Plan, inherited-core, plugin skill, and
temporary ABSORB artifacts. In the same query, the composite implementation
files did not exhibit corresponding active execution/edit coupling. This is a
practical proxy for a large change-propagation radius and context working set.

## 4. Crystallization rule

The core rule is:

> Crystallize repeated mechanics and authority; preserve bounded judgment.

Repeated deterministic work should move:

```text
agent/prompt → structured workflow → typed contract/DSL → deterministic code
```

while irreducible judgment remains agent-driven behind narrow interfaces.

Good candidates to crystallize:

- input normalization and path resolution;
- state transitions, retry, resume, and halt behavior;
- worktree creation, merge, cleanup, and recovery;
- cache ownership and invalidation;
- resource claims and effect leases;
- receipt construction and validation;
- task/dashboard/backlog/counter mutation;
- required gate and test-profile selection.

Judgment that may remain molten:

- independent Proposal generation and adjudication;
- design alternative comparison;
- semantic/domain-misfit reasoning;
- adversarial counterexample search;
- policy for a genuinely new task class before repeated evidence exists.

Even molten judgment must receive bounded inputs, return a typed result, and
hold no undeclared shared-state write authority.

## 5. Target interfaces

### 5.1 Control-plane kernel

The kernel should own only execution mechanics:

```ts
interface RunIdentity {
  runId: string
  candidateId: string
  taskIds: string[]
  attempt: number
  baseCommit: string
  workflowSourceHash: string
  runtimeGeneration: string
}

interface StageSpec {
  name: StageName
  adapter: string
  inputSchema: string
  outputSchema: string
  readSet: string[]
  writeSet: string[]
  semanticResources: string[]
  resourceClaims: ResourceClaim[]
}
```

The kernel owns the stage state machine, worktree lifecycle, scheduling,
resource admission, receipt verification, journal, retries, and recovery. It
does not interpret task content or embed class-specific Build instructions.

### 5.2 Stage adapters

Prepare, Verify, Build, Audit, and Gate should expose one common form:

```ts
run(input: StageInput): Promise<StageReceipt>
```

An adapter:

- receives explicit paths, identities, commits, policy, and resource grants;
- runs in the supplied worktree or read-only snapshot;
- emits candidate commits, immutable artifacts, or receipts;
- cannot update primary-checkout lifecycle or governance state;
- cannot choose the next workflow transition.

### 5.3 Evidence plane

Every reusable result must be bound to what it proves:

```ts
interface StageReceipt {
  identity: RunIdentity
  stage: StageName
  candidateCommit: string
  inputHashes: Record<string, string>
  outputHashes: Record<string, string>
  commands: CommandEvidence[]
  verdict: "pass" | "fail" | "concerns"
  producedAt: string
}
```

At minimum, the system needs distinct Build, AuditVerdict, Gate, Reconcile, and
Land receipts. A report without base/candidate commit, inputs, source hash, and
runtime generation is descriptive evidence, not a reusable proof.

### 5.4 Reconcile and Land transaction

The write-authority invariant should be:

```text
Build  → candidate worktree only
Audit  → immutable verdict only
Gate   → immutable check receipts only
Reconcile → deterministic proposed mutation transaction
Land   → sole fenced applier to shared authoritative state
```

Reconcile validates auditor independence, receipt hashes, task coverage,
candidate freshness, and gate completeness, then produces one transaction.
Land alone may merge to the integration branch and update task lifecycle,
ABSORB state, dashboard, backlog, and milestone counter.

This single-writer boundary is the main prerequisite for safe stage-level
parallelism.

### 5.5 Policy registry

Task routing should be versioned data:

```ts
interface ExecutionPolicy {
  taskKind: string
  preparationProfile: string
  buildProfile: string
  verificationProfiles: string[]
  auditProfile: string
  requiresPostLandWiring: boolean
  resourceClaims: ResourceClaim[]
}
```

The registry should own Proposal→Plan requirements, class routing, required
gates, verification profiles, post-Land wiring requirements, learning barriers,
audit policy, and resource budgets. The workflow consumes the resolved policy;
it does not reproduce the policy as prompt branches.

## 6. Migration sequence

### C0 — Measure and freeze semantic expansion

- Add stage timestamps, agent-call counts, test invocations, effect observations,
  prompt bytes, and shared-state writes without changing scheduling.
- Build golden replay fixtures for legacy singleton, composite, failure,
  recovery, and concurrent paths.
- Inventory each workflow invariant and identify its single intended owner.
- Avoid adding new behavior directly to the monolith unless needed to unblock
  the convergence work.

### C1 — Establish one physical isolation service

After the orthogonality symlink/direct-entry mismatch is fixed, implement
`DIR-123` using one reusable worktree manager:

- create candidate branch/worktree;
- resolve execution cwd;
- bind it to `RunIdentity`;
- merge under the integration owner;
- clean up or recover deterministically.

DIR-119-D's per-phase isolation must use this service rather than create a
second worktree implementation.

### C2 — Establish identity, journal, and receipt ownership

- Make run/candidate/attempt/base/runtime identity mandatory.
- Single-source milestone-root and evidence-path resolution.
- Persist receipts and Verify cache in one journal/store.
- Reject receipts from another commit, input set, workflow hash, or generation.
- Make resume an explicit state-machine operation, not caller folklore.

### C3 — Remove Audit and Gate write authority

- Literally invoke the read-only audit mechanism.
- Reject attempted task, ABSORB, dashboard, lifecycle, or index mutations.
- Convert checklist/disposition changes into Reconcile inputs.
- Preserve fresh-context adversarial reasoning while making its output
  immutable and replayable.

### C4 — Wire phase-DAG Build and deterministic Reconcile

Implement the live behavior required by `DIR-119-D` and align it with
`DIR-118`:

- synthesize a real phase/shard execution manifest;
- dispatch Build calls from the phase DAG;
- dispatch the declared number of read-only audit shards;
- add a literal Reconcile phase;
- prove the tree remains clean through Audit and becomes dirty only at the
  authorized reconciliation/application boundary;
- preserve width-one behavior without unnecessary fan-out.

Once wired, remove prompt text that simulates the same composite modules.

### C5 — Extract policy and shrink the workflow

- Move task-kind routing, required gates, test profiles, wiring contracts, and
  resource claims to the policy registry.
- Replace mechanical prompt paragraphs with adapter calls.
- Reduce OUTER-LOOP to a pointer to executable policy/state contracts.
- Delete compatibility paths only after recorded replay proves they are unused
  or safely migrated.

The target `execute-milestone` entry point should perform only:

```text
normalize identity
resolve policy
advance state machine
dispatch adapter
validate receipt
enqueue ReadyToLand
```

### C6 — Enable the stage pipeline

Apply the separate pipelining/lease proposal after the boundaries above exist:

- worktrees and optimistic validation by default;
- resource semaphores for agents, CPU, memory, full suites, and ports;
- effect leases only for real file/semantic conflicts;
- one integration fence around Reconcile/Land;
- rolling Ready-to-Land rather than batch-wide fan-in.

This ordering prevents locks from becoming compensation for unknown effects.

## 7. Safety invariants

1. Every stage has one declared input/output/effect contract.
2. Every rule has one authoritative executable owner.
3. No receipt is valid outside its bound base, candidate, inputs, workflow
   source, and runtime generation.
4. Build mutates only its candidate worktree.
5. Audit and Gate are mechanically read-only.
6. Reconcile is deterministic for identical validated receipts.
7. One fenced Land owner mutates shared authoritative state.
8. A stale candidate or receipt is revalidated or invalidated before Land.
9. No prompt may grant an authority that the adapter/kernel does not enforce.
10. Composite width does not change atomic Land accounting.
11. Halt blocks new admission and new Land transactions while preserving
    recoverable completed receipts.
12. Legacy singleton behavior remains replay-compatible through migration.

## 8. Verification and metrics

Crystallization is measured by reduced propagation and instability, not by file
count. Record:

- **change-propagation radius:** files and semantic owners touched per workflow
  rule change;
- **context working set:** documents/files read to make a local repair;
- **shared-writer count:** stages capable of task/dashboard/backlog/counter
  mutation;
- **duplicate-rule count:** rules represented in workflow, OUTER-LOOP, scripts,
  and task prose;
- **prompt-to-code ratio:** mechanical behavior still expressed only as prompt;
- **receipt reuse rate:** valid stages skipped safely on retry/resume;
- **replay variance:** variation in calls, tests, effects, and outputs for the
  same inputs;
- **failure attribution precision:** whether a failure identifies stage, input,
  commit, command, and runtime generation;
- **full-suite executions per candidate commit;**
- **Land-fence hold and queue time.**

The convergence milestone is not “the workflow file became shorter.” It is:

> A stage implementation can change without understanding the whole milestone
> lifecycle; its receipt is sufficient for the next transition; and no
> component outside deterministic Reconcile/fenced Land can modify shared
> authoritative facts.

Required evidence should include:

1. golden replay of the legacy singleton path;
2. a real composite journal whose Build and Audit call counts match its
   manifest;
3. negative controls for stale receipts and wrong runtime generations;
4. an Audit mutation attempt rejected mechanically;
5. a failed/retried worker resuming from valid receipts;
6. two overlapping worktree candidates with an intentionally conflicting case
   handled before or at fenced Land;
7. one candidate landing without waiting for an unrelated slow candidate; and
8. a crash before and after Land commit with no duplicate lifecycle transition,
   dashboard entry, or counter increment.

## 9. Risks and rejected shortcuts

### File splitting without authority reduction

Rejected. Moving prompt blocks into separate files preserves the same hidden
effects and duplicated knowledge.

### Adding another prose specification layer

Rejected. This would reproduce the additive-prose paradox: more descriptions
to reconcile without a harder executable boundary.

### Locking the whole workflow

Rejected as a target architecture. It suppresses concurrency and hides
undeclared effects. Worktrees, immutable receipts, optimistic validation, and a
short integration fence provide the primary safety model.

### Freezing judgment prematurely

Avoided. Interfaces should crystallize repeated observed invariants. Proposal,
design, and adversarial reasoning remain agent-driven until their stable
mechanics are evidenced, but their authority and outputs are bounded now.

### Keeping both prompt and typed implementations indefinitely

Rejected. A migration may temporarily dual-run them for comparison, but each
cutover must delete or reduce the superseded representation. Otherwise the
target architecture remains a shadow and `L_G` continues to rise.

## 10. Relationship to the current task order

This proposal does not replace the current correction sequence:

1. fix `gap-touches-orthogonality-symlink-isdirect-mismatch`;
2. implement `DIR-123` worktree isolation;
3. schedule `gap-drain-dispose-body-corruption` where convenient because its
   touch set is disjoint;
4. fix `gap-build-phase-iteration-evidence-path-not-single-sourced`.

Those changes establish prerequisites and remove active defects. The next
convergence front should then combine the compatible responsibilities of
`DIR-119-D` and `DIR-118` around literal phase execution, immutable read-only
audit receipts, deterministic reconciliation, runtime-generation provenance,
and sole-writer Land.

The existing stage-pipelining proposal describes how the resulting crystalline
stages run concurrently. This proposal describes the prior architectural work
needed to make those stages real, narrow, and safe to pipeline.
