# Proposal — Unifying Prepare and Execute as a convergent feedback system

- **Status:** proposal / architecture and measurement guidance only
- **Date:** 2026-07-29
- **Scope:** treat `prepare-milestone` and `execute-milestone` as two coupled
  error-correcting feedback loops, then reduce end-to-end delivery cost without
  weakening fail-closed behavior, independent review, or real-runtime evidence.
  This document does not itself modify either workflow, create a directive, or
  authorize a runtime-generation upgrade.
- **Evidence base:** Git changes and Claude Code workflow/session journals in
  the 24-hour window ending 2026-07-29, including M192, M194–M201; a follow-up
  stage-level reconstruction covering 350 recent Prepare-agent journals; the
  live `.claude/workflows/{prepare,execute}-milestone.js` sources; findings
  recorded by `DIR-126`; and historical Git samples from the earlier
  Proposal/Plan-driven development periods in the local `archguard` and
  `meta-cc` projects.
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

The two *information dimensions* currently represented by Proposal and Plan
remain necessary. Two full, independently rewritten prose documents do not.
The target is:

- a canonical Proposal for problem semantics, mechanisms, invariants, failure
  modes, and acceptance boundaries;
- a compact execution projection for ordering, touch sets, RED/GREEN
  commands, evidence, and rollback;
- a standalone Plan only when task risk and dependency structure justify its
  marginal cost; and
- an independent Execute audit against the materialized candidate regardless
  of how much preparation was performed.

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

### 2.6 Follow-up task-level reconstruction

A second reconstruction used raw Claude agent journals modified since
2026-07-28. Its wider denominator differs from the 24-hour workflow-call
sample above, so the totals should not be combined. It found about 2.68M
output tokens across identifiable Prepare agents:

| Prepare stage family | Agent-minutes | Output tokens | Share of identified agent time |
|---|---:|---:|---:|
| Proposal authors | about 269m | 797,593 | 31% |
| Proposal adjudication | about 256m | 932,840 | 29% |
| Proposal review/revision/delta | about 190m | 523,655 | 22% |
| Plan authoring | about 50m | 106,285 | 6% |
| Plan checking/revision | about 99m | 310,321 | 11% |
| Receipt | about 5m | 13,114 | under 1% |

Proposal work therefore consumed about 82% of identified Prepare agent time
and 84% of output tokens. This does not prove Proposal is unimportant. It
shows that author competition, adjudication, review, and full-document
revision are the dominant optimization surface.

End-to-end elapsed time from preparation start/charter to prepared receipt,
including retries and persisted repair commits, was:

| Milestone/task | Prepare elapsed | Prepare-related commits | Code churn | First Execute audit |
|---|---:|---:|---:|---|
| M192 / DIR-120 | 7h16m | 13 | 883 | `CONCERNS` |
| M195 / DIR-117-B | 2h14m | 3 | 580 | `CONCERNS` |
| M198 / DIR-119-D1 | 3h43m | 10 | 1,956 | `REFUTED`, then repaired |
| M200 / DIR-126-A | 1h18m | 3 | 1,395 | `REFUTED`, then repaired |

The median Prepare elapsed time was about 2h57m. The comparable observable
execution windows had a median near 55m, although some are Build-agent windows
and others include audit repair, so the ratio is directional rather than a
benchmark. Preparation was commonly two to three times the execution
critical path and was much worse for M192.

The findings justify part of this cost. Proposal work caught missing direct
deletion proof, an out-of-glob test, an incomplete terminal-state contract, a
necessary phase split, touch-set mismatches, an untested force-release path,
and an admission-error fail-closed gap. PlanCheck repaired ordering, command,
evidence, and touch-set defects. But M198 still reached Build with a real
`sync-vendor.sh` regression, and M200's first Audit refuted 10 of 15 ACs and
two of four DoD items. Among five recent comparable executions, one was clean,
two had concerns, and two were refuted. Textual convergence did not imply
empirical convergence.

M201 / DIR-126-B had already consumed about 33 Proposal agent-minutes, 21 Plan
agent-minutes, and 210K output tokens at the observation cutoff without a
terminal prepared receipt. Its useful discoveries included real table-row
parsing and citation/stale-count defects; those findings do not require the
surrounding full-document regeneration cost to remain valuable.

### 2.7 Cross-project granularity

The early Claude Code journals for `archguard` are no longer locally
available, and the old `meta-cc` journals are incomplete. Their historical
durations below are therefore Git timestamp windows from the last relevant
Proposal/Plan commit to the implementation commit, not active coding time.
Very short windows can mean code was already staged. Code and document sizes
are exact Git/file measurements; duration is only a proxy.

| Historical sample | Proposal + Plan lines | Net code additions | Code churn | Timestamp window |
|---|---:|---:|---:|---:|
| archguard Plan 27 | 1,780 | 895 | 982 | 148m |
| archguard Plan 03 | 675 | 1,284 | 1,795 | 102m |
| archguard Plan 38 | 729 | 1,127 | 1,184 | 21m |
| meta-cc phases 29–30 | about 568 | 1,200 | 1,351 | 77m |
| meta-cc phases 52–55 | 911 | 1,721 | 1,743 | 31m |
| meta-cc core-type decoupling | 305 | 679 | 1,001 | 9m |
| meta-cc streaming reader | 936 | 1,078 | 1,236 | 37m |

For bounded single-task samples, the resulting project-level medians are:

| Project period | Specification lines | Net code additions | Code churn | Specification/code-add ratio |
|---|---:|---:|---:|---:|
| recent Quay | about 854 | about 560–610 | 883 | about 1.4–1.5 |
| early archguard | 729 | 1,127 | 1,184 | about 0.65 |
| early meta-cc | about 580–740 | 1,078 | 1,236 | about 0.55–0.69 |

The historical impression is directionally correct: an `archguard` or
`meta-cc` task commonly changed about twice as much code as a recent Quay task,
and several 1,000-line tasks landed inside an approximately one-hour commit
window. Quay now writes roughly twice as many Proposal/Plan lines per added
code line. Quay can still exceed 1,000 lines of code churn per hour on larger
tasks; the main difference is description density, not an absolute inability
to produce large changes.

Quality does not reduce to test volume. Tests accounted for roughly 50–73% of
code churn in the sampled older projects. In `archguard`, however, Plan 38's
surface was touched by five fix-labelled commits within 24 hours, and the
shared Plans 33–37 surface by about ten corrective commits. That supports a
large-batch rework cost. The analogous immediate-fix proxy is weaker for
`meta-cc`; its cost appears more as later architectural cleanup and decoupling,
so the claim that its early changes were lower quality remains plausible but
is not proven by immediate fix density alone.

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

Proposal and Plan should therefore behave like distinct projections, not
parallel paraphrases:

```text
Proposal projection:
  what / why / mechanism / invariant / failure boundary

Execution projection:
  order / dependency / changed surface / command / evidence / rollback
```

Redundancy corrects errors only when the observations are sufficiently
independent. Multiple agents reading the same task and repository through the
same parent context, then rewriting the same Markdown artifact, create
correlated redundancy. The extra tokens are not proportional to extra
information. Full regeneration can even move a previously settled coordinate
and make the process non-contractive, as M192 demonstrated.

The desired loop intentionally tolerates early error:

```text
semantic constraint
  → small reversible implementation slice
  → empirical observation
  → focused correction with retained evidence
```

Convergence, rather than zero pre-Build error, is the governing property.
Preparation should minimize the expected cost of the next useful observation,
not maximize textual certainty before reality is sampled.

### 3.1 Are separate Proposal and Plan stages necessary?

The decision is risk-sensitive:

| Task shape | Proposal treatment | Execution treatment |
|---|---|---|
| Existing, bounded defect or one mechanism | canonical task Proposal plus one independent semantic review | generated execution manifest; no standalone prose Plan |
| Medium uncertainty or several dependent stages | focused Proposal revision, preserving resolved findings | thin Plan plus one check and at most one focused revision |
| Ambiguous architecture, security/concurrency/migration, irreversible or broad wiring change | competing alternatives/adjudication only when justified | standalone Plan with explicit dependencies, evidence, and rollback |

A default fast-lane candidate has one mechanism, no more than about five
production/test files, predicted code churn below about 800, and no migration,
concurrency, security-boundary, irreversible-state, or broad runtime-wiring
change. These are calibration seeds, not permanent hard-coded policy.

The generated execution manifest should normally be 30–100 lines or a
structured receipt containing only:

- ordered stages and dependencies;
- AC-to-stage and AC-to-evidence mappings;
- bounded touch set;
- RED/GREEN and final verification commands; and
- rollback/recovery requirements.

For full-lane work, a standalone Plan should be a delta over Proposal,
typically 120–200 lines. It references AC and mechanism identifiers rather
than restating their prose. Default review is one adversarial semantic
reviewer, not two or three Proposal authors plus adjudication. Multiple
authors remain available when there are genuinely competing architectural
directions.

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

### 5.4 DIR-126-D's landed Prepare-telemetry record — the real, frozen producer shape this section's `StageReceiptEnvelope` will eventually consume

DIR-126-D/M203 landed the first REAL, committed producer of per-generation
Prepare telemetry — `proposal-convergence.ts`'s `buildTelemetryRecord()`,
written to `milestones/prepare-telemetry/<taskId>/<recordId>.json`
(`schemaVersion: 2`, a superset of DIR-126-C's own gitignored
`.generation.json` `schemaVersion: 1`):

```text
TelemetryRecord (schemaVersion: 2) {
  recordId, attemptId, generationId
  admission: {key, ownerExecutionId, fencingToken, acquiredAt}
  workspace, taskId, milestoneId, class, highRisk
  hashes: {charter, taskContract, proposal, reviewPolicy}
  decision: {kind, reason, priorGenerationId, priorReason, createsContentGeneration}
  contentAgentDispatchCount, contentAgentMs
  terminal: {outcome, reason, phase, cacheable}
  leaseRelease: {attempted, ok, reason}
  sessionId, recordedAtMs, telemetryWriteOk
}
```

This is a deterministic, direct precursor to §5.2's `StageReceiptEnvelope`
above — a future DIR-124-B adapter can map `TelemetryRecord` fields onto
`StageReceiptEnvelope` fields one-for-one (`generationId` -> a component of
`runIdentity`; `terminal.{outcome,reason}` -> `outcome`/`reason`;
`contentAgentDispatchCount`/`contentAgentMs` -> `contentAgentCount`/
`agentMinutes`; `hashes.*` -> `inputHashes`) without parsing prose or Claude
Code session JSONL. **DIR-126-D remains the Prepare telemetry PRODUCER, never
a second cross-workflow receipt authority** — nothing in
`proposal-convergence.ts`/`milestone-preparation-check.ts` reads FROM a
`RunIdentity`/`StageReceiptEnvelope`-shaped file (no reverse or dual-write
dependency; verified by grep over this child's own diff, zero matches).
`milestone-preparation-check.ts`'s new `--telemetry-report <milestoneId>` CLI
mode (§5.2's read path precedent) answers per-generation telemetry queries
today, without waiting on this section's own eventual `StageReceiptEnvelope`
rollout. Per-phase intra-generation timing (`{phase, round, startedAtMs,
endedAtMs}` breakdowns) and `findingCodes[]`/`recurrenceKey` recurrence
tracking are explicitly OUT of this record's scope — filed separately as
`tasks/gap-dir126d-deferred-phase-timing-recurrence-tracking.md` (real,
separable follow-up work), cross-referenced here rather than silently
dropped.

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

### Stage 1.5 — risk-sensitive Proposal and execution projection

- Add a measured risk/granularity classifier after deterministic preflight.
- Fast lane: preserve the canonical Proposal, run one independent semantic
  review, and derive a compact execution manifest without a prose Plan.
- Full lane: use competing Proposal authors only for genuine alternatives;
  produce a Plan that contains execution deltas rather than duplicated design
  prose.
- Cap default full-lane checking at one PlanCheck and one focused revision.
  Further rounds require a new blocking finding, changed input hash, or human
  authorization.
- Never restart a full Proposal generation merely to resolve a non-blocking
  wording or citation defect.

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

- Removing the semantic dimensions currently checked by ProposalReview and
  PlanCheck. Their implementation may become a fast-lane review and a derived
  execution-manifest check instead of two mandatory long-document stages.
- Removing Acceptance Audit or fail-closed Gates.
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
11. Fast-lane tasks keep Prepare critical-path time below 30% of Execute time
    in the calibrated median; full-lane tasks keep it below 60%.
12. Proposal-plus-Plan/manifest lines per net code addition fall below 0.5 for
    fast-lane work and below 0.8 for full-lane work without increasing the
    prepared-to-Audit refutation rate.
13. Telemetry reports unique blocking findings per 10K output tokens,
    duplicate/false-positive findings, escaped downstream defects, and
    post-Land repair churn, so reduced cost cannot be mistaken for improved
    quality.

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
7. Which classifier inputs can be deterministic, and which risk labels require
   human confirmation before choosing the fast lane?
8. Should the fast-lane execution manifest be committed Markdown, a
   hash-bound structured receipt, or a generated view over one canonical
   machine-readable artifact?

## 15. Implementation status — finding back-propagation mechanism (2026-08-06)

`gap-audit-findings-not-backpropagated-to-earlier-detectors` landed the §7 back-propagation
mechanism as two byte-identical script pairs (experiments + plugin mirrors):

- `scripts/finding-backpropagate.ts` — `classifyFinding` (deterministic task-specific|profile|
  global + `earliestDetectableStage` + promotion decision; rejects promotion when the required
  evidence does not exist at the proposed earlier stage, AC1), the concrete PlanCheck detector
  `detectAcCoverageCitations` (the REAL M208 finding class, recurrenceKey `ac7-checklist-missing`),
  `proveDetector` (RED/GREEN/ambiguous calibration with measured false-positive rate, AC2),
  `backpropagate` (authorized activation, AC3/AC4), `controlFalsePositive` (AC8), and
  `reportBackpropagationMetrics` (AC7, reads only canonical receipts + DIR-126-D/E telemetry;
  missing cost inputs are explicit unknowns).
- `scripts/execution-policy.ts` — the minimal versioned policy-hash + authorized-activation
  substrate DIR-124-D adopts: `createPolicy`, `authorizeActivation` (a distinct authorized
  transition — the originating observer can never self-activate), `revokeActivation`,
  `invalidateReceiptsForPolicyChange` (a policy activation changes the policy hash and invalidates
  exactly the affected cached receipts).

Proof case: the real, independently-confirmed M208 finding
(`milestones/M208/proposal-ledger.json` entry `55016c0b`, rootCauseKey `ac7-checklist-missing`)
migrates via `migratePrepareLedger` to a FindingEnvelope, classifies eligible at PlanCheck, and is
calibrated against RED/GREEN/ambiguous corpora. The M192 Build-null runtime finding is the AC1
negative control (rejected for promotion to PlanCheck). A later-real-milestone early-catch proof
(AC5) and the end-to-end value estimate (DIR-126-E) remain pending future milestones and are
reported as unknown rather than fabricated.
