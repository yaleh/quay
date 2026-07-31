# Proposal - Size-aware Build execution for `execute-milestone`

- **Status:** proposal / measured policy recommendation
- **Date:** 2026-07-31
- **Evidence window:** M198 and M200-M207 Claude Code executions on
  2026-07-29 through 2026-07-31
- **Scope:** reduce `execute-milestone` critical-path time by sizing the Build
  before dispatch, selecting a size-appropriate verification strategy, and
  stopping repeated full-suite runs and out-of-scope diagnosis.
- **Related:**
  [`gap-execute-milestone-build-admission-and-verification-fuse`](../../tasks/gap-execute-milestone-build-admission-and-verification-fuse.md)
  owns the size route, test ladder, checkpoints, and repeated-failure fuse. ·
  [`gap-build-evidence-manifest-missing`](../../tasks/gap-build-evidence-manifest-missing.md)
  owns the planned/actual evidence reconciliation and pre-Audit evidence gate. ·
  [`quay-milestone-workflow-task-sizing-and-adaptive-execution.md`](./quay-milestone-workflow-task-sizing-and-adaptive-execution.md)
  defines the corresponding Prepare-stage sizing policy. ·
  [`quay-milestone-workflow-throughput-capacity-model.md`](./quay-milestone-workflow-throughput-capacity-model.md)
  supplies the earlier M185-M189 execution baseline. ·
  [`quay-milestone-workflow-stage-pipelining-and-leases.md`](./quay-milestone-workflow-stage-pipelining-and-leases.md)
  and [`DIR-123`](../../tasks/DIR-123.md) define the worktree and resource
  isolation required for safe concurrency.

## 1. Decision summary

`execute-milestone` should route Build from three observable dimensions rather
than apply one prompt and one verification pattern to every task:

```text
implementationScale = mechanisms + logical source/test surfaces
proofScale          = unit | integration | real-workflow | cross-generation
verificationRisk    = suite breadth + shared resources + known flaky surfaces
```

The estimate is a routing decision, not a delivery promise. It selects a Build
budget, checkpoints, evidence obligations, and test escalation policy.

The initial policy should be:

1. Build writes an Acceptance-Criterion-to-evidence matrix before editing.
2. During implementation it runs only the narrowest relevant tests.
3. It runs the relevant combined suites once, then the full suite once at the
   end when the task requires repository-wide regression evidence.
4. A failure outside `## Touches` receives at most one isolated clean-worktree
   reproduction. A repeated equivalent failure stops full-suite redispatch.
5. At 45 minutes Build emits a progress checkpoint. At 60 minutes it must
   split an independently deliverable remainder, disposition an external
   failure, or obtain an explicit large-task continuation decision.
6. Build must not return `done` while an AC requiring real workflow evidence is
   supported only by source grep, mocked-agent tests, or self-report.

For the observed M207 run, this policy would have retained one final full run
and one isolated reproduction instead of eight full or near-full runs. The
estimated saving is 50-55 minutes without weakening the final evidence.

## 2. Measurement method and limits

The sample uses the raw Claude Code workflow transcripts under the primary
session `9b3ffa31-5bd7-4274-86f3-74def2f0a1f1`. A stage begins at its agent's
first timestamp and ends at its final timestamp. Verify is measured from
workflow start through preparation verification; Gate is the interval after
Audit through the start of Land or `needs-human` handling.

Six runs are complete: M198 and M200-M204. M207 has completed Build and Audit
but had not reached Gate or Land at the evidence cutoff, so it is reported as
an in-progress observation rather than pooled into completed-run statistics.

Tool time is the interval between each `tool_use` and matching `tool_result`.
It includes process startup and tool transport, but excludes model reasoning
between calls. Test classification is command-based and therefore separates
full-suite time reliably while treating mixed shell commands conservatively.

The Claude session-wide index was blocked by one malformed unrelated JSONL
record during collection. Direct reads of the targeted workflow transcripts
and checked-in iteration/audit artifacts remained available; no sample timing
depends on the broken index.

## 3. Stage timing results

| Milestone | Verify | Build | Audit | Gate | Land/handling | Workflow total |
|---|---:|---:|---:|---:|---:|---:|
| M198 | 2.8m | 70.0m | 20.4m | 0.7m | 1.9m | 95.7m |
| M200 | 1.4m | 19.8m | 10.9m | 1.4m | 2.8m | 36.3m |
| M201 | 1.3m | 34.3m | 11.7m | 1.0m | 1.8m | 50.1m |
| M202 | 2.1m | 27.3m | 13.2m | 0.7m | 4.9m | 48.1m |
| M203 | 1.5m | 51.3m | 10.2m | 0.9m | 2.1m | 65.9m |
| M204 | 1.7m | 41.9m | 17.7m | 1.8m | 17.3m | 80.4m |
| M207, in progress | 2.1m | **120.9m** | 30.5m | - | - | >153.5m |

Across the six completed runs:

| Stage | Mean | Median | Aggregate share |
|---|---:|---:|---:|
| Verify | 1.8m | 1.6m | 2.9% |
| Build | **40.8m** | **38.1m** | **65.0%** |
| Audit | 14.0m | 12.4m | 22.3% |
| Gate | 1.1m | 1.0m | 1.7% |
| Land/handling | 5.1m | 2.4m | 8.1% |
| Total | 62.8m | 58.0m | 100% |

Verify and Gate are stable fixed costs. Build is both the largest stage and the
most variable. M204's 17.3-minute Land is an exception caused by an audit
artifact entering a concurrent M205 preparation commit and requiring a later
reconciliation commit; it is evidence for worktree isolation, not a reason to
optimize ordinary Land logic first.

## 4. Audit refutation is the larger multiplier

Workflow duration alone understates delivery cost because a `REFUTED` Audit
ends the recorded attempt before coordinator-driven repair and re-audit.

| Outcome | Milestones | Mean workflow-start-to-final-Land |
|---|---|---:|
| First-pass landable | M202, M204 | about 64m |
| Audit `REFUTED` | M198, M200, M201, M203 | about 133m |

Only 2 of 6 completed runs were first-pass landable. The four refuted runs
took about 2.1 times as long to reach final Land. M203 is the clearest case:
its 51.3-minute Build and 65.9-minute workflow attempt were followed by about
124 additional minutes before Land.

The repeated failure was not insufficient test volume. It was missing or
misclassified evidence:

- M198 changed `sync-vendor.sh` without updating a hard-coded packaging-count
  regression fixture.
- M200 proved concurrency at the primitive CLI layer rather than through the
  required `Workflow` harness and omitted several branch fixtures.
- M201's own real-task dogfood exposed false positives not covered by its
  detector fixtures, followed by further over-correction rounds.
- M203 ran broad suites but supplied static call-site counts where the AC
  required real journals and had no committed telemetry record.

Build efficiency therefore requires both faster verification and correct
evidence selection. Reducing tests without an evidence matrix would shorten
the first attempt while increasing post-Audit rework.

## 5. Build-stage decomposition

| Milestone | Build wall time | Shell/tool wait | Full-suite time | Observed pattern |
|---|---:|---:|---:|---|
| M202 | 27.3m | 9.9m | 5.6m, 1 run | One unrelated serve failure, then focused confirmation |
| M203 | 51.3m | 24.9m | 9.8m, 2 runs | Resource failures plus several broad targeted reruns |
| M204 | 41.9m | 18.9m | **17.8m, 2 runs** | Full suites consumed almost all shell time |
| M207 | 120.9m | **79.5m** | **70.6m, 8 runs** | Battery reruns, clean-tree checks, load/concurrency diagnosis |

M207 spent its first 10 minutes reading and establishing a baseline, began
editing at 22:12, started its first full battery at 22:34, wrote the iteration
report at 23:42, and committed at 00:02. The final 89-minute verification and
diagnostic interval was dominated by full-suite reruns.

The triggering failure was outside the milestone's declared Touches:
`packages/quay/test/build-dist-smoke.test.mjs` sometimes exceeded a six-second
serve-readiness window under full-suite load. Build then tested clean stashes,
lower concurrency, concurrent load, and orphan process cleanup before widening
that test's polling window. This mixed three distinct units of work into one
Build:

```text
M207 feature implementation
+ environment/flaky-test diagnosis
+ out-of-Touches test-infrastructure repair
```

The diagnosis was technically grounded, but retaining it inside the original
critical path was inefficient and expanded review scope.

## 6. Size and route before Build

Mirror files count once when estimating logical scope. Generated evidence,
task prose, iteration reports, and audit artifacts do not count as
implementation surfaces. The initial routing tiers are:

| Tier | Observable signals | Default Build route |
|---|---|---|
| S | One mechanism, <=4 logical source/test files, local proof only | 25-35m target; focused tests; full suite only if explicitly required |
| M | Two mechanisms or 5-8 logical files; workflow/integration wiring | 40-60m target; implementation and proof checkpoints; one final full suite |
| L | More than two mechanisms, >8 logical files, or CLI/workflow/receiver traversal with real-dispatch proof | Split by default, or 75-120m explicitly approved route with staged commits |

These tiers complement, rather than replace, the churn estimator in the
Prepare sizing proposal. Churn predicts implementation volume; the signals
above predict Build critical-path and evidence cost.

M207 must route as L even though it described only two additive fields. It
crossed three runtime layers, changed three mirrored pairs, required receiver
history behavior and workflow wiring, and carried broad regression evidence.
Charter length and mechanism count alone concealed that proof surface.

Before dispatch, compute and persist at least:

```json
{
  "mechanismCount": 2,
  "logicalTouchCount": 10,
  "proofScale": "real-workflow",
  "requiresFullSuite": true,
  "sharedResources": ["test-cpu", "ports"],
  "buildTier": "L"
}
```

## 7. AC-to-evidence matrix

The Build agent should materialize a compact matrix before editing:

| AC | Required evidence class | Planned command/artifact | Status |
|---|---|---|---|
| AC-N | source invariant | exact source assertion or diff | pending |
| AC-N | focused behavior | named unit/integration fixture | pending |
| AC-N | workflow behavior | real `Workflow()` journal | pending |
| AC-N | production history | checked-in runtime artifact | pending |

Evidence classes are not interchangeable. In particular:

- source grep cannot satisfy a real-dispatch clause;
- a primitive CLI race cannot satisfy workflow-level concurrency;
- mocked-agent execution cannot satisfy a real-agent or journal clause;
- a Build report's assertion cannot substitute for the named artifact; and
- a full green suite cannot prove that an unexercised production branch ran.

The workflow should reject Build `done` when a required row remains pending or
has been downgraded to a weaker evidence class without an explicit disposition.

## 8. Verification escalation and fuse

### 8.1 Test ladder

```text
baseline affected tests
  -> narrow RED/GREEN test
  -> affected module/mirror suites
  -> relevant combined suites
  -> one final full suite, when required
```

A level advances only after the previous level is green. Returning to the full
suite is not a diagnosis technique; a failed full run must be reduced to the
smallest reproducer first.

### 8.2 Repeated-failure fingerprint

Define a test failure fingerprint from normalized test file, test name, exit
class, and normalized top stack frame:

```text
sha256(testFile + testName + exitClass + topFrame)
```

Two equivalent full-suite fingerprints in one Build open the fuse:

1. stop full-suite redispatch;
2. run one focused reproducer;
3. if the failure is outside Touches, run it once in a clean isolated
   worktree/environment;
4. record `caused-by-change`, `pre-existing`, `environmental`, or `unknown`;
5. continue only on the affected path, or return a typed `needs-human` result
   if the task's acceptance contract requires a globally green suite.

An out-of-Touches repair becomes a separate task unless it is a deterministic
regression caused by the current diff and blocks required acceptance. This
keeps scope, Audit, and rollback boundaries honest.

### 8.3 Time checkpoints

| Elapsed Build time | Required action |
|---:|---|
| 30m | Compare progress with the initial S/M/L route |
| 45m | Emit completed mechanisms, green evidence, remaining work, and dominant blocker |
| 60m | Split an independent remainder, disposition an external failure, or record an explicit L continuation |
| 90m | No further full-suite retry; coordinator decides continue, split, or stop |

Time alone does not force a bad split. It forces an explicit decision instead
of allowing a verification or diagnostic loop to consume an unbounded Build.

## 9. Isolation and resource controls

Every Build should execute in a milestone-specific worktree with:

- a private Git index and candidate branch;
- milestone-scoped temp and fixture directories;
- allocated port ranges;
- a process group that is terminated at Build exit;
- an explicit full-suite CPU/memory semaphore; and
- immutable base, task, charter, Plan, and preparation-receipt hashes.

This would have prevented M204's audit artifact from entering an M205 commit
and reduced the chance that orphaned M207 test processes changed later timing.
Worktrees do not isolate CPU or ports, so the test semaphore and process cleanup
remain necessary.

Resource-heavy suites should use bounded concurrency selected by measurement.
More test workers are not assumed to be faster: M207 demonstrated that load can
push a six-second readiness boundary into intermittent failure and turn one
suite into repeated ten-minute diagnostic cycles.

## 10. Proposed workflow contract

Add a deterministic `BuildAdmission` step after Verify and before the Build
agent:

```text
Verify
  -> BuildAdmission(size, proof, resources, evidence matrix)
  -> Build(checkpoints, test ladder, failure fuse)
  -> BuildEvidenceGate
  -> Audit
```

`BuildAdmission` returns:

```json
{
  "tier": "M",
  "softBudgetMs": 2700000,
  "decisionCeilingMs": 3600000,
  "requiredEvidence": ["integration", "real-workflow"],
  "fullSuitePolicy": "once-at-end",
  "resourceLeases": ["full-suite"],
  "splitCheckpoint": true
}
```

`BuildEvidenceGate` is mechanical. It verifies that the iteration report names
each AC, its evidence class, the actual command/artifact, and its result. Audit
remains adversarial and independent; the gate only prevents known incomplete
evidence from consuming a fresh Audit attempt.

## 11. Rollout and validation

### Phase 1 - Instrument only

Record tier inputs, checkpoint timestamps, test commands, failure
fingerprints, full-suite count, and evidence-class coverage without changing
control flow. Validate on at least ten `execute-milestone` runs.

### Phase 2 - Advisory routing and fuse

Expose the proposed tier and warnings to the Build agent. Enforce the repeated
full-suite fuse, but allow a coordinator override with a recorded reason.

### Phase 3 - Mechanical evidence gate

Require the AC-to-evidence matrix and reject only structurally missing rows.
After false-positive calibration, enforce evidence-class compatibility for
real-workflow and cross-generation clauses.

### Phase 4 - Adaptive dispatch

Route S/M/L prompts, budgets, checkpoints, test resources, and split behavior
automatically. Use measured distributions rather than the initial thresholds
once the sample is large enough.

## 12. Success criteria

Compare rolling windows by size and proof tier, not as one blended average.
The first validation target is:

- completed-run Build median: 38.1m -> <=33m;
- first-pass landable rate: 33% -> >=65%;
- full-suite executions per Build: p50 <=1 and p90 <=2;
- repeated identical full-suite fingerprints after the fuse: zero;
- out-of-Touches repairs committed inside Build: zero unless explicitly
  dispositioned as caused-by-change blockers;
- Audit refutations caused by missing evidence class: reduced by at least 50%;
- workflow-start-to-Land p50 and p90 reported separately for each S/M/L and
  proof tier; and
- no increase in escaped regression rate or post-Land rollback rate.

The first-pass rate is the most important guard. A lower Build median obtained
by handing incomplete evidence to Audit is not an efficiency improvement.

## 13. Non-goals

This proposal does not:

- weaken Audit independence or acceptance criteria;
- declare every full-suite failure ignorable;
- use elapsed time alone to split cohesive mechanisms;
- permit concurrent Builds in the primary worktree;
- treat generated mirror files as free at execution time; or
- replace the Prepare-stage churn/proof estimator.

The proposal changes when and how evidence is produced, and bounds repeated
diagnostic work. It does not lower the evidence bar.
