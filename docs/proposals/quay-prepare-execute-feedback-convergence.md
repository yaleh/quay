# Proposal — Unifying Prepare and Execute as a convergent feedback system

- **Status:** proposal / architecture and measurement guidance only
- **Date:** 2026-07-29
- **Scope:** treat `prepare-milestone` and `execute-milestone` as two coupled
  error-correcting feedback loops, then reduce end-to-end delivery cost without
  weakening fail-closed behavior, independent review, or real-runtime evidence.
  This document does not itself modify either workflow, create a directive, or
  authorize a runtime-generation upgrade.
- **Evidence base:** Git changes and Claude Code workflow/session journals in
  the 24-hour window ending 2026-07-29, including M192, M194–M200; the live
  `.claude/workflows/{prepare,execute}-milestone.js` sources; and the findings
  recorded by `DIR-126`.
- **Related:**
  [`quay-milestone-workflow-git-crystallization.md`](./quay-milestone-workflow-git-crystallization.md)
  defines the executable-kernel and receipt boundaries. ·
  [`quay-milestone-workflow-throughput-capacity-model.md`](./quay-milestone-workflow-throughput-capacity-model.md)
  defines throughput units and capacity guidance. ·
  [`quay-milestone-workflow-stage-pipelining-and-leases.md`](./quay-milestone-workflow-stage-pipelining-and-leases.md)
  defines cross-candidate scheduling and leases. ·
  [`DIR-126`](../../tasks/DIR-126.md) owns Prepare efficiency, admission,
  generation reuse, telemetry, and capacity recalibration. ·
  [`DIR-123`](../../tasks/DIR-123.md), [`DIR-119-D`](../../tasks/DIR-119-D.md),
  [`DIR-124`](../../tasks/DIR-124.md), and [`DIR-118`](../../tasks/DIR-118.md)
  own worktree isolation, literal composite execution, control-plane
  crystallization, and post-Land wiring proof.

## 1. Decision summary

Quay should model milestone delivery as one feedback system with two different
observation channels:

```text
Prepare: requirements/design feedback
  task + charter
    → Proposal alternatives
    → adjudicated Proposal
    → grounded Proposal review
    → executable Plan
    → checked preparation receipt

Execute: implementation/empirical feedback
  checked receipt
    → Verify
    → Build candidate
    → read-only acceptance Audit
    → Gates
    → deterministic Reconcile
    → fenced Land
    → post-Land wiring observation
```

Prepare reduces uncertainty before implementation. Execute tests the concrete
candidate against repository, test, Git, runtime, and lifecycle reality.
Neither loop is sufficient alone:

- a coherent Proposal and Plan do not prove that the implementation or
  runtime wiring is correct;
- a strong post-Build audit does not justify spending Build cost on defects
  that deterministic preflight could have rejected;
- allowing findings to remain local to one loop causes the other loop to pay
  repeatedly for the same information.

The architectural objective is therefore:

```text
cheap checks first
  + hash-bound incremental state
  + positive-success transitions
  + read-only observations
  + deterministic mutation ownership
  + typed feedback flowing to the earliest valid detector
```

The system may continue to tolerate local errors. It must not tolerate a
non-contractive process in which the same error is rediscovered without
preserving information or reducing the expected remaining distance to a
deliverable state.

## 2. Recent measured baseline

The figures below are a diagnostic sample, not a performance promise. Workflow
minutes are summed per-run wall times. Agent minutes are reconstructed from
each agent transcript's first and last timestamps. `subagent_tokens` is the
Workflow notification's aggregate token field; it is not assumed to be pure
output tokens or a billing amount.

### 2.1 End-to-end comparison

| Measure | Prepare | Execute |
|---|---:|---:|
| Real/non-fixture calls | 15 | 8 |
| Summed workflow time | about 466m | about 359m |
| Active agent time | about 518m | about 370m |
| Known subagent tokens | at least 5.70M | 6.281M |
| Mean workflow time/call | about 31m | about 45m |
| Mean active agent time/call | about 35m | about 46m |
| Strict success terminal | 2 `prepared` | 3 `done` |
| Strict terminal yield | about 13% | 38%, or 43% excluding a deliberate negative control |

Prepare's strict yield is not a direct quality score: most non-success calls
returned useful findings or a correct split decision. Conversely, an Execute
`done` is not infallible: M192 returned `done` after a terminally errored Build
agent because the workflow accepted a null result and later stages happened to
recover the shared-tree changes.

### 2.2 Cost of a blocking result

Thirteen recent Prepare attempts stopped before producing a receipt:

```text
Prepare blocking cost ≈ 338 summed minutes / 13
                      ≈ 26 minutes per blocked attempt
```

Five Execute calls produced a blocking result: one Prepared rejection, one
Gate failure, and three Audit refutations:

```text
Execute blocking cost ≈ 192 summed minutes / 5
                      ≈ 38 minutes per blocked attempt
```

Excluding the deliberately stale three-minute Prepared negative control, a
real Execute failure cost about 47 minutes on average. This is expected:
implementation-dependent defects cannot be observed until a candidate exists.
It also quantifies the value of moving a recurring, generalizable finding to
an earlier valid detector.

### 2.3 Prepare agent-time distribution

Across the completed non-fixture M195, M196, M198, M199, and M200 samples:

| Prepare stage | Agent-minutes | Share |
|---|---:|---:|
| ProposalAuthors | about 154m | 30% |
| Adjudicate | about 117m | 23% |
| ProposalReview, revisions, and mechanical claim checks | about 144m | 28% |
| PlanAuthor | about 31m | 6% |
| PlanCheck and Plan revisions | about 68m | 13% |
| Receipt | about 4m | under 1% |

M196 dominates Authors and Adjudicate cost: five generations consumed about
183 summed workflow-minutes, two generations overlapped for about 54 minutes,
and the task never reached PlanAuthor before being split. M195's successful
generation shows the other long tail: roughly 57 minutes in the PlanCheck
path before a receipt was produced.

### 2.4 Execute agent-time distribution

| Execute stage | Agent-minutes | Share |
|---|---:|---:|
| Verify | 21.5m | 5.8% |
| Prepared | 2.0m | 0.5% |
| Build | 204.3m | 55.3% |
| Acceptance Audit | 79.7m | 21.6% |
| Gates | 12.5m | 3.4% |
| Land | 42.7m | 11.6% |
| Refuted/failure disposition | 7.0m | 1.9% |

Seven recent executions reached Acceptance Audit. Three were `REFUTED`, two
returned `CONCERNS`, and two found no refutation. Audit is therefore expensive
but demonstrably informative. Prepared is extremely cheap and precise. Verify
and Gate are comparatively cheap, but many deterministic scripts are still
wrapped in agents.

### 2.5 Deliverable and description throughput

The same 24-hour Git window changed 119 files:

| Artifact class | Added | Deleted |
|---|---:|---:|
| Production/workflow code | 2,138 | 600 |
| Tests and fixtures | 1,472 | 114 |
| Tasks, Plans, audits, charters, and milestone evidence | 9,458 | 273 |
| Other documentation | 63 | 15 |

The process-artifact-to-code-plus-test addition ratio is 2.62:1, and about
3.97:1 after removing identifiable mirrored code/test copies. These figures
must remain descriptive rather than targets. M194 delivered value primarily
by deleting duplicate configuration behavior; line count alone would
undervalue it. Process artifacts are valuable only when they preserve
constraints, make evidence replayable, or reduce future uncertainty.

## 3. Geometric-information-theory model

Represent the effective project state as:

```text
x = (
  task contract,
  charter,
  Proposal,
  Plan,
  code,
  tests,
  configuration,
  runtime wiring,
  Git state,
  lifecycle state,
  evidence
)
```

Each check defines a feasible set:

```text
M_i = { x | constraint C_i(x) holds }
M   = intersection of all M_i
```

A deliverable milestone is not merely source code that compiles. It is a point
inside the intersection of design, implementation, evidence, runtime, and
lifecycle constraints.

Prepare and Execute perform alternating projections:

```text
Proposal authors      explore candidate directions
Adjudicate             compress candidates into one representation
ProposalReview         measure distance to design/wiring constraints
PlanCheck              project onto executable file/command/dependency constraints
Build                  materialize one candidate
Acceptance Audit       measure distance to implementation/evidence constraints
Gate                   measure mechanical repository/lifecycle constraints
Reconcile/Land         perform the authoritative state transition
Post-Land Wiring Audit observe next-generation runtime reachability
```

An error-tolerant process is convergent when a suitable error potential
contracts in expectation:

```text
E[d(x_(k+1), M) | x_k] <= rho * d(x_k, M) + epsilon
where rho < 1
```

The important distinction is not success versus failure. It is informative
failure versus repeated failure:

```text
information gain of failure
  = uncertainty before finding - uncertainty after durable finding
```

A new, grounded finding can have high value even when the attempt returns
`needs-human`. A repeated finding with the same recurrence key and no changed
input has near-zero information gain. Concurrent duplicate generations are
worse: they pay twice before either trajectory can consume the other's
feedback.

## 4. Feedback quality: Prepare versus Execute

| Dimension | Prepare | Execute |
|---|---|---|
| Object observed | intended design and Plan | materialized implementation and evidence |
| Earliest detection | before Build | mostly after Build |
| Precision | medium; Markdown/regex false positives observed | high; usually grounded in real diff, tests, journal, or runtime |
| Semantic breadth | high | high, with stronger empirical grounding |
| Recurrence | high across fresh generations | lower, but unmet evidence can require another full execution |
| Independence | multiple authors/reviewers, often one parent runtime | fresh-context Audit is stronger, though runtime generation may still be shared |
| State retention | improving through resume; historically weak | stronger through commits, audit artifacts, and task write-back |
| Failure cost | lower | higher |
| Main blind spot | implementation reality | defects that should have been rejected before Build |

Prepare produces a prior over plausible implementations. Execute provides the
empirical likelihood of one concrete candidate. A low Prepare distance does
not imply a low Execute distance: M198 and M200 reached a checked receipt and
were still refuted by Acceptance Audit. That is not automatically a Prepare
failure; some facts only exist after Build. It becomes a Prepare failure when
the Audit finding was predictable from the pre-Build contract, such as a Plan
promising only mocked evidence for an AC that explicitly requires a real
workflow journal.

Execute also has a feedback-integrity escape. In M192 the Build `agent()` call
returned null after a terminal API error. The workflow currently accepts every
outcome except the literal string `needs-human`, so Audit and Land ran against
uncommitted shared-tree state and happened to rescue it. The implementation
was valid, but the workflow's state transition was not. A feedback system
cannot be trusted if “no observation” is interpreted as success.

## 5. Proposed unified feedback contract

### 5.1 One finding envelope

Prepare review, PlanCheck, Acceptance Audit, Gate, and post-Land wiring checks
should emit one versioned finding shape:

```text
FindingEnvelope {
  schemaVersion
  findingId
  recurrenceKey
  runIdentity
  taskId
  milestoneId
  observerStage
  subsystem
  claimRef
  severity
  blocking
  summary
  evidenceRefs[]
  inputHashes
  firstSeenGeneration
  lastSeenGeneration
  disposition
  resolvedBy
  earliestDetectableStage
  generalization: task-specific | profile | global
  detectorCandidate?
}
```

`findingId` identifies one occurrence. `recurrenceKey` identifies the same
defect class across generations. `inputHashes` prevents an old verdict from
being reused against changed material. `earliestDetectableStage` enables
feedback back-propagation without pretending every implementation finding can
be detected from a Proposal.

### 5.2 One stage receipt envelope

Every stage should emit a hash-bound receipt:

```text
StageReceiptEnvelope {
  runIdentity
  stage
  attempt
  sourceCommit
  candidateCommit?
  inputHashes
  policyHash
  workflowHash
  startedAt
  endedAt
  mechanicalRunnerCount
  contentAgentCount
  agentMinutes
  tokenUsage
  findings[]
  outputArtifactRefs[]
  outcome
  reason
}
```

This extends the direction already owned by DIR-126-D and DIR-124-B. It is not
a second task or Plan source. Tasks, charters, Proposals, and Plans remain
authoritative content; receipts bind what was observed and decided.

### 5.3 Build evidence manifest

Build should return more than `{outcome, iterationCount, mergeCommit}`:

```text
BuildEvidenceManifest {
  baseCommit
  candidateCommit
  changedFiles[]
  testsRun[]
  testResults[]
  acEvidence[]
  runtimeEvidence[]
  deferredOrUnmet[]
  iterationArtifactRefs[]
}
```

Audit remains independent and must verify raw artifacts. The manifest supplies
a bounded index and makes omissions mechanically visible; it does not allow
Audit to trust the producer's conclusion.

## 6. Proposed stage order and ownership

### 6.1 Admission and validation before expensive observation

The desired front of the pipeline is:

```text
Prepare Admission
  → deterministic Prepare Preflight
  → generation decision (cold | resume | reuse-terminal)
  → content/review stages
  → Prepare receipt

Execute minimal argument normalization
  → Prepared receipt/hash validation
  → deterministic Verify checks
  → semantic Verify checks
  → Build
```

Prepared currently follows Verify. The deliberately stale M195 control spent
seven agents and 328,856 subagent tokens even though the Prepared check itself
used only about 0.6 agent-minutes. A stale or missing receipt should fail
before domain/dogfood Verify work.

### 6.2 Deterministic checks are scripts, not agent jobs

The workflow kernel should directly execute and structure the results of:

- task-canonical/ceiling checks;
- gate-hash and line-budget checks;
- preparation-receipt validation;
- composite preflight;
- tree/worktree/branch hygiene;
- split-or-commit;
- dashboard/vmeta constraints; and
- other checks whose contract is an exit code plus bounded stdout/stderr.

Agents remain appropriate for domain-misfit reasoning, grounded Proposal
review, Plan semantics, implementation Audit, and wiring interpretation. This
change targets tokens and failure surface more than wall time: current
parallel script-runner agents are already short in wall time.

### 6.3 Positive-success transitions

Every content-agent stage must proceed only on an explicitly accepted success
outcome:

```text
accepted(outcome) = outcome == "done"
```

Null, undefined, unknown strings, schema mismatch, or missing required fields
must fail closed with a typed reason. In particular, Build must reject
`buildResult?.outcome !== "done"` before dispatching Audit, Gate, or Land.

### 6.4 Read-only observers and one mutation owner

The target tail is:

```text
Build candidate
  → read-only Acceptance Audit receipt
  → read-only Gates
  → deterministic Reconcile decision
  → fenced transactional Land
  → post-Land mechanical checks
  → next-generation Wiring Audit when required
  → deterministic lifecycle promotion
```

Audit and Gate must not tick tasks, write dashboard rows, append dispositions,
or stage artifacts in the authoritative checkout. Reconcile validates receipt
hashes and owns deterministic write-back. Land owns the integration
transaction. Post-Land checks catch violations that pre-Land Gate cannot
observe, including a parent/child lifecycle violation introduced by Land
itself.

## 7. Feedback back-propagation

Every blocking Execute finding should be classified after independent
confirmation:

```text
task-specific:
  stays in the task/iteration evidence

profile:
  becomes a verification-contract or touched-surface rule

global:
  becomes a candidate for deterministic Prepare Preflight,
  PlanCheck, Build self-check, Gate, or post-Land check
```

Promotion requires:

1. a stable recurrence key;
2. evidence that the class occurred more than once, or one occurrence with
   sufficiently severe blast radius;
3. an earliest stage where the required facts actually exist;
4. a deterministic or calibrated detector with RED/GREEN cases;
5. measured false-positive behavior before fail-closed activation; and
6. one owner and one production callsite.

Examples:

| Execute finding | Earliest valid detector | Proposed treatment |
|---|---|---|
| AC requires a real journal but Plan schedules only mocks | PlanCheck | compare evidence modality in AC versus Plan |
| canonical/plugin mirror omitted | PlanCheck or Build preflight | derive mirror closure from sync manifest |
| Build agent returned null | Execute transition | positive-success check |
| parent done while child remains open after Land | post-Land/CI | run whole-store split-or-commit after mutation |
| production wiring claimed but only source exists | Audit/Wiring Audit | verification-contract profile |
| task-specific algorithm bug | Build/Audit | do not globalize without recurrence evidence |

This is how the system learns without accumulating an unbounded collection of
fragile global regexes.

## 8. Cost-aware check ordering

For independent or safely reorderable checks, prioritize approximately by:

```text
priority_i =
  P(block at i | stage reached) * avoided downstream cost
  -------------------------------------------------------
  cost_i + false-positive cost_i
```

The recent sample implies:

- Prepared has very low cost and can avoid all Verify/Build cost, so it moves
  earlier.
- Mechanical Verify has low observed blocking yield; it remains required but
  should run directly and use hash-bound caching.
- Gate is cheap and found a real lifecycle problem; retain it and add a
  post-Land form where state changes can introduce new violations.
- Acceptance Audit has high blocking yield but cannot run meaningfully before
  implementation. Reduce its search cost with a Build evidence manifest and
  preserve its independent, refute-first role.
- Recurring Audit classes that depend only on task/Plan facts should migrate
  upstream after calibrated detector proof.

The ordering function is descriptive policy, not permission to skip a
required invariant because its recent observed hit rate is zero.

## 9. Metrics

### 9.1 End-to-end value and cost

Delivered value should be measured as verified capability, not lines:

```text
V = sum(
  capabilityWeight
  * acceptanceCoverage
  * observerIndependence
  * productionReachability
) - regressionRisk
```

Cost includes:

```text
C =
  critical-path wall time
  + alpha * active agent minutes
  + beta * token use
  + gamma * human reconciliation time
  + delta * process-artifact maintenance
```

The primary efficiency measure is:

```text
eta = verified value change / total cost
```

LOC, duration, and token fields remain explanatory diagnostics. They must not
become individual productivity targets.

### 9.2 Convergence and feedback measures

Record at least:

- first Prepare admission to verified Land latency;
- workflow attempts per landed candidate;
- active agent-minutes and tokens per verified capability;
- duplicate-generation overlap;
- cold/resume/reuse-terminal mix;
- finding novelty and recurrence rate;
- resolved-finding retention and reopened rate;
- Prepare strict-terminal yield;
- prepared-to-Audit refutation rate;
- Prepare escape rate: findings caught downstream that were detectable from
  pre-Build facts;
- Audit back-propagation rate: generalizable findings promoted to an earlier
  proven detector;
- Build-result schema/terminal failures;
- post-Land regression escape rate; and
- process-artifact growth per independently closed constraint.

Suggested definitions:

```text
Prepare escape rate =
  downstream findings whose earliestDetectableStage <= PlanCheck
  / executions with a valid preparation receipt

Audit back-propagation rate =
  generalizable Audit findings promoted to a proven earlier detector
  / all independently confirmed generalizable Audit findings

recurrence waste =
  agent-minutes spent rediscovering an unchanged recurrenceKey
  / total feedback agent-minutes
```

Targets must be calibrated by DIR-126-D/E from at least three real post-change
generation shapes. The hard qualitative targets are:

- unintended duplicate generation overlap is zero;
- unchanged stable terminal recomputation uses zero content agents;
- unknown/null stage results never advance;
- read-only stages produce zero authoritative mutations;
- every lifecycle mutation is checked after it occurs; and
- weakening independent review is never counted as an efficiency gain.

## 10. Rollout sequence and existing ownership

This proposal should be implemented through existing task ownership wherever
possible, not by creating a second shadow roadmap.

### Stage 0 — baseline and transition safety

- Complete DIR-126-A single-flight admission.
- Close the Build-null positive-success gap.
- Record stage telemetry without changing pass/fail policy.
- Preserve a golden replay of existing success and failure terminals.

### Stage 1 — cheap checks and generation reuse

- DIR-126-B: calibrated deterministic Prepare Preflight.
- DIR-126-C: hash/policy-bound `cold|resume|reuse-terminal`.
- Move Prepared validation ahead of semantic Verify after a behavior-preserving
  fixture proves the reordering.
- Replace deterministic script-runner agents with direct kernel calls where
  existing task ownership permits.

### Stage 2 — receipts and evidence transfer

- DIR-126-D and DIR-124-B: versioned run identity, findings, stage telemetry,
  receipts, and resume validation.
- Add the Build evidence manifest.
- Preserve current task/Proposal/Plan authority; receipts remain evidence, not
  a second content source.

### Stage 3 — read-only observation and deterministic mutation

- DIR-119-D2/D3/D4/D5: real phase-DAG Build, read-only Audit shards,
  deterministic Reconcile, and atomic Land.
- DIR-123: physical worktree isolation.
- Add post-Land lifecycle checks.

### Stage 4 — runtime wiring and adaptive policy

- DIR-118: post-Land, next-generation Wiring Audit and lifecycle promotion.
- DIR-124-C/D: deterministic control-plane kernel and versioned policy
  registry.
- DIR-126-E/DIR-124-E: capacity calibration, stage scheduling, and adaptive
  resource allocation from real telemetry.

Before implementation, each existing task must be checked for exact scope
overlap. If no existing task owns a required increment, file one narrow task
for that increment rather than treating this proposal as executable authority.

## 11. Risks and mitigations

### 11.1 Moving a check earlier can use incomplete facts

Mitigation: every finding records `earliestDetectableStage`. Only rules whose
inputs exist at that stage may move upstream. Runtime reachability remains an
Audit/Wiring-Audit concern.

### 11.2 Globalized findings can create false-positive debt

Mitigation: require recurrence/severity evidence, calibration, RED/GREEN
fixtures, stable reason codes, and measured false-positive behavior before
fail-closed activation.

### 11.3 Receipts can become a duplicate source of truth

Mitigation: receipts contain hashes, identities, findings, outcomes, and
artifact references; they do not restate authoritative requirements or Plan
content.

### 11.4 Cost-aware ordering can be mistaken for optional safety

Mitigation: invariants remain mandatory. Ordering optimizes when they run and
how they are implemented, not whether they run.

### 11.5 Feedback optimization can reward shallow tasks

Mitigation: normalize value by verified capability and risk, never by raw
attempt count, LOC, or low duration.

### 11.6 Shared runtime identity can overstate independence

Mitigation: receipts record parent session, agent session, workflow source,
runtime generation, and candidate commit. Verification contracts explicitly
state when a later cold runtime generation is required.

## 12. Non-goals

- Removing ProposalReview, PlanCheck, Acceptance Audit, or fail-closed Gates.
- Treating `prepared` as equivalent to implementation completion.
- Treating `done` as operational wiring proof when the task requires a later
  runtime generation.
- Replacing task-specific judgment with an unlimited global regex catalogue.
- Maximizing strict success rate by weakening checks.
- Using LOC, tokens, or duration as a personal productivity score.
- Enabling broad concurrent writes before worktree isolation and fenced Land
  exist.
- Reimplementing DIR-126, DIR-119-D, DIR-123, DIR-124, or DIR-118 under a new
  name.

## 13. Falsifiable outcomes

The combined optimization is successful only when real post-change evidence
shows:

1. A missing, stale, or hash-invalid preparation receipt returns before any
   semantic Verify or Build agent dispatch.
2. A null, undefined, unknown, or schema-invalid Build result dispatches no
   Audit, Gate, Reconcile, or Land work.
3. Deterministic Verify/Gate checks have direct executable callsites and
   preserve prior verdicts under golden replay.
4. Audit and Gate produce immutable receipts and zero authoritative working
   tree mutations.
5. Reconcile is the sole owner of task/dashboard/disposition write-back, and
   Land is the sole integration transaction owner.
6. Split-or-commit and other mutation-sensitive invariants are checked after
   Land's state changes, not only before them.
7. At least one independently confirmed Execute Audit finding is promoted to
   an earlier calibrated detector and then caught there in a real later
   milestone.
8. Unchanged recurring findings reuse their durable state rather than spending
   a fresh full-generation review.
9. Three or more post-change real generations of different terminal shapes
   produce reproducible end-to-end cost, finding, and value metrics without
   reading private Claude session JSONL.
10. Independent audits confirm that efficiency improved without reducing
    acceptance coverage, runtime reachability evidence, or failure closure.

## 14. Open decisions

1. Should Prepared move before all Verify work, or should a minimal
   argument/charter-integrity subset remain ahead of it?
2. Which existing DIR-073 increments remain valid versus being absorbed by
   DIR-124's kernel/policy work?
3. Should Build evidence manifests be emitted by the Build adapter, a
   deterministic post-Build collector, or both with cross-validation?
4. Which findings deserve automatic profile/global promotion, and which
   require explicit human authorization?
5. Should post-Land checks run inside the Land transaction before commit
   visibility, immediately after commit with rollback support, or in both
   forms for different invariants?
6. What minimum real sample size is required before changing author count,
   review-round caps, or stage capacity?
