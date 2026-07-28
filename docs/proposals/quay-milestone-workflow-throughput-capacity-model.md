# Proposal — Milestone workflow throughput and capacity model

- **Status:** proposal / measurement and rollout guidance only
- **Date:** 2026-07-28
- **Scope:** consolidate the M185–M189 timing analysis, the observed cost of
  milestone preparation, and the concurrency discussion into a capacity model
  for the DIR-124 migration. The figures below are planning hypotheses, not
  performance promises; DIR-124-A and DIR-124-E must replace them with measured
  values from real tasks.
- **Related:**
  [`quay-milestone-workflow-stage-pipelining-and-leases.md`](./quay-milestone-workflow-stage-pipelining-and-leases.md)
  defines the execution architecture and stage/lease contracts. ·
  [`quay-milestone-workflow-git-crystallization.md`](./quay-milestone-workflow-git-crystallization.md)
  defines the preceding crystallization sequence. ·
  [`milestone-workflow-performance-and-capability-regression-analysis.md`](../milestone-workflow-performance-and-capability-regression-analysis.md)
  records the underlying Git/session/build evidence. ·
  [`DIR-124`](../../tasks/DIR-124.md) turns that sequence into implementation
  tasks, while [`DIR-123`](../../tasks/DIR-123.md) restores the required
  worktree isolation.

## 1. Decision summary

Quay should optimize the milestone lifecycle as a stage pipeline, not by
raising one undifferentiated workflow-concurrency integer. A useful first
deployment target is:

```text
Prepare(M+2) ───────────────┐
Verify/Build(M+1) ──────────┼─→ Ready-to-Land queue
Audit/Gate(M) ──────────────┘          │
                                      ▼
                         parallel pure Reconcile
                                      │
                                      ▼
                         linearizable fenced Land
```

The scheduler should enforce a small set of non-negotiable safety invariants,
then tune stage capacities from observed queue time, utilization, contention,
retry, and stale-work rates. Worktree count, active Build count, full-suite
slots, and effective agent concurrency are configuration values. They are not
architectural constants.

The initial safe target after DIR-124-E is **1.4–1.9 completed singleton
candidates/hour**. With a conservative composite width of 1.15–1.30, that is
about **1.6–2.5 completed leaf tasks/hour**. A mature deployment with more
isolated resources may reach **2.5–4.0 singleton candidates/hour** and
**3.0–6.0 leaf tasks/hour**. These ranges deliberately distinguish rollout
targets from later capacity and must be validated on real workloads.

## 2. Units: three rates, not one

Every throughput report must name its numerator:

- **candidate/h:** completed milestone candidates that reached a valid Land;
- **leaf-task/h:** canonical task completions, so a composite candidate counts
  by its successfully landed task width; and
- **workflow-attempt/h:** executions including failed/review-refuted retries.

Attempts are work, not delivered value. Reporting attempts as “tasks” makes a
retry-heavy system look faster. Conversely, comparing a width-three composite
with a singleton as one “milestone” hides useful task packing.

For an observation window of duration `H`:

```text
candidate throughput = landed candidates / H
leaf-task throughput = Σ(landed candidate width) / H
attempts per candidate = workflow attempts / landed candidates
```

Latency is separate again: p50/p90 time from admission to Land. Throughput can
rise while one task waits longer, so both rate and latency must be guarded.

## 3. Historical baseline

The M185–M189 investigation reconstructed these stage durations:

| Run | Total | Verify | Build | Audit | Gate | Land/handling |
|---|---:|---:|---:|---:|---:|---:|
| M185 | 45.8m | 1.60m | 25.13m | 10.14m | 0.34m | 7.82m |
| M186 | 79.2m | 1.22m | 47.78m | 27.30m | 0.50m | 1.66m |
| M187 | 30.6m | 1.32m | 14.23m | 7.02m | 0.55m | 6.73m |
| M188 iteration 0 | 65.3m | 1.80m | 52.31m | 8.72m | 0.76m | 1.17m |
| M188 iteration 1 | 43.2m | 1.22m | 26.94m | 7.94m | 0.45m | 5.99m |
| M189 | 88.5m | 2.26m | 40.87m | 37.39m | 0.60m | 6.60m |
| **Mean attempt** | **58.8m** | **1.57m** | **34.54m** | **16.42m** | **0.53m** | **4.33m** |

The six attempts delivered five canonical tasks because M188 required two
iterations:

```text
aggregate work = 352.6 attempt-minutes
work-normalized cost = 352.6 / 5 = 70.5 minutes per delivered task
work-normalized throughput ≈ 0.85 task/h
```

M186 and M187 genuinely overlapped, so the observed wall-time delivery rate was
slightly higher, approximately **0.90–0.95 task/h**. The sample is small and
workload-mixed; it is a baseline envelope, not a benchmark suite.

The distribution also says where capacity matters. Verify and Gate are short.
Build and Audit dominate agent-minutes and critical paths, while retries add a
large multiplicative penalty. Land is correctness-critical but, at its
historical 3–5 minute scale, is not yet the likely throughput bottleneck.

## 4. Prepare changes the baseline

A real DIR-117 `prepare-milestone` execution took **22m 21s**, including
multiple substantive review passes. Until more observations exist, use
**15–25 minutes** as the planning range.

Simply prepending Prepare to the old serial workflow would produce:

```text
70.5 historical delivered-task minutes + 15–25 Prepare minutes
≈ 85–95 minutes per task
≈ 0.63–0.71 task/h
```

A practical early range might be 0.65–0.80 task/h as caching and task mix vary,
but it would still be a regression from the observed baseline. Therefore
DIR-124-E must overlap Prepare with other candidates' Build/Audit. Pipelining
only Verify, Build, and Audit leaves a new 15–25 minute serial head stage and
cannot meet the intended throughput gain.

## 5. Capacity model

At steady state, candidate throughput is bounded by the scarcest service:

```text
throughput ≤ min(
  available agent-minutes / agent-minutes per candidate,
  Build-worker service capacity,
  Prepare/Audit service capacity,
  full-suite service capacity,
  Land linearization capacity,
  eligible candidate supply
)
```

The formula is intentionally a bound, not a claim that all services are
independent. CPU/memory contention can increase Build and suite service time;
stale candidates and review refutations consume capacity without increasing
the numerator; dependency or generation barriers can starve the eligible
queue.

At 3–5 minutes per transaction, a serial Land point has a theoretical capacity
of 12–20 lands/hour. That is well above the near-term target. Agent-minutes,
Prepare review, full-suite contention, eligible candidate supply, and
conflict/rework rate are more plausible first bottlenecks. The design should
keep the Land fence short rather than prematurely allowing concurrent writes to
the same authoritative integration target.

Composite packing applies a value multiplier:

```text
leaf-task throughput
≈ candidate throughput × mean successfully landed composite width
```

This multiplier must use landed width, not selected width; partial or refuted
members do not count.

## 6. Hard invariants versus tunable policy

### 6.1 Required safety invariants

1. Every writable candidate has its own branch, worktree, and index.
2. Audit and Gate cannot mutate authoritative project state.
3. Every receipt binds candidate, base, inputs, policy, and runtime generation.
4. Land against one authoritative integration target is linearizable, atomic,
   fenced, recoverable, and idempotent.
5. External exclusive resources are protected by leases or semaphores.
6. A hard dependency cannot produce a valid downstream promotion receipt
   before its prerequisite becomes authoritative.
7. Halt prevents new stage admission and new Land transactions.

These conditions protect state integrity. Removing one requires a replacement
proof, not merely favorable performance measurements.

### 6.2 Rollout defaults, not invariants

The following limits are sensible conservative defaults on the current
single-machine deployment, but should remain configurable:

- two simultaneously active candidate worktrees;
- effective agent concurrency of 1.5–2.0;
- exactly one full-suite slot;
- one Reconcile worker;
- treating every path overlap as a Build conflict; and
- blocking all speculative work across any dependency or generation change.

More than two worktrees may exist; disk-resident candidates and active Builds
are separate capacities. Pure Reconcile may run concurrently because it
produces a proposed patch/receipt; only the final validation and authoritative
Land commit point must linearize. A single full-suite slot is justified by
recent single-host contention and timeout evidence, but isolated runners can
raise that semaphore safely.

After worktrees are restored, touch overlap is no longer a physical checkout
safety violation. It becomes a predicted merge/rework risk. Dependencies should
classify work as authoritative, speculative, or blocked. A runtime-generation
change normally invalidates proof and promotion; it need not forbid all
Prepare/Build work whose output can be revalidated.

## 7. Stage-specific concurrency

Admission should be made per stage:

| Stage | Default concurrency posture | Serialization reason |
|---|---|---|
| Prepare | parallel, bounded by review/agent slots | dependency inputs and policy generation must be declared |
| Verify | parallel, cache-aware | shared external resources only |
| Build | parallel in isolated worktrees | CPU/memory and semantic-conflict risk |
| Audit | parallel and read-only | agent/review capacity |
| Gate | parallel except leased resources | full-suite/browser/external service capacity |
| Reconcile | parallel pure computation | none until authoritative comparison |
| Land | one fenced commit point per integration target | linearizable shared-state transition |

Admission can become increasingly speculative without weakening promotion:

- **authoritative:** all prerequisites and generations match; candidate may
  progress to Land;
- **speculative:** Prepare/Build may proceed, but receipts must be revalidated
  after the dependency/generation becomes authoritative; and
- **blocked:** work would be misleading, destructive, or too expensive to
  discard, so it is not admitted.

This distinction prevents a coarse dependency graph from unnecessarily idling
Build capacity while preserving fail-closed Land semantics.

## 8. Throughput hypotheses

### 8.1 Safe rollout after DIR-124-E

Assuming roughly two active independent candidates, 1.5–2.0 effective agent
concurrency, one full-suite slot, and one fenced Land writer:

```text
singleton candidates: 1.4–1.9/h
leaf tasks at width 1.15–1.30: 1.6–2.5/h
```

This is the first safe target, not Quay's architectural ceiling.

### 8.2 Mature resource-aware deployment

With 6–8 usable agent slots, about three active Builds, two or three combined
Prepare/Audit slots, a local full-suite slot (or equivalent isolated-runner
capacity), concurrent pure Reconcile, linearized Land, and stage-specific
speculative admission:

```text
singleton candidates: 2.5–4.0/h
typical leaf tasks:    3.0–6.0/h
```

Workload shape remains decisive:

```text
small, highly orthogonal gap tasks: 5–8 leaf tasks/h
large capability-growth tasks:      1.5–2.5 leaf tasks/h
```

These are envelopes for capacity planning. They should not be averaged into a
single SLA without classifying task size and composite width.

### 8.3 Operational targets

| Tier | Singleton candidate throughput | Leaf-task throughput |
|---|---:|---:|
| Safe launch | ≥1.5/h | ≥1.8/h |
| Steady state | ≥2.2/h | ≥3.0/h |
| Stretch | 3–4/h | 4–6/h |

Quality, retry, and latency gates below take precedence over a headline rate.

## 9. Recommended sequence before DIR-118

The throughput work depends on restoring and crystallizing correctness
boundaries first:

```text
complete DIR-117 / DIR-119
→ DIR-124-A (instrumentation and replay baseline)
→ gap-touches-orthogonality-symlink-isdirect-mismatch
→ DIR-123 (real worktree isolation)
→ gap-build-phase-iteration-evidence-path-not-single-sourced
→ DIR-124-B (identity, journal, receipts, resume)
→ DIR-124-C (kernel and stage adapter ABI)
→ DIR-124-D (policy/resource registry)
→ DIR-124-E (resource-aware stage pipeline)
→ measured create-or-defer decision for DIR-124-F
→ DIR-118
```

After DIR-123 and before DIR-124-E, DIR-112 may proceed as a parallel side
task. `packages/quay/test/cli.test.mjs` was observed at about 236 seconds inside
the full suite and 109 seconds in isolation, with 68 sequential subprocesses.
It is therefore a direct full-suite capacity improvement, not a prerequisite
for the control-plane interfaces.

`gap-drain-dispose-body-corruption` is disjoint from the sequence and may be
scheduled opportunistically when it does not consume a scarce pipeline
resource needed by the critical path.

## 10. Measurement gates for DIR-124-E

DIR-124-A should establish a serial/control baseline over 8–12 real tasks.
DIR-124-E should then observe 8–12 comparable real tasks through the pipeline.
The first rollout is accepted only when:

1. median completed-task throughput improves by at least 50%;
2. p90 admission-to-Land latency does not worsen by more than 15%;
3. observed full-suite concurrency never exceeds configured capacity;
4. contention timeouts fall by at least 70%;
5. attempts per delivered task fall from 1.20 toward 1.10 or below;
6. at least 60% of eligible retries reuse still-valid receipts;
7. no full suite runs while holding the Land fence;
8. stale/refuted/discarded work and escaped-quality rates do not regress; and
9. candidate and leaf-task throughput are reported separately.

Create DIR-124-F only if fan-in/Ready-to-Land wait still exceeds 10% of median
task wall time after DIR-124-E. Otherwise preserve the smaller mechanism.

Example capacity adjustments:

```text
Build queue p50 > 10m and CPU < 70%
  → activeBuildMax +1

full-suite queue p50 > 5m and resource headroom > 40%
  → fullSuiteSlots +1

Land queue p50 > 5m
  → parallelize pure Reconcile and shorten the fence before changing Land safety

eligible candidate queue < 2
  → candidate supply is the bottleneck; do not add workers
```

Every increase needs a rollback threshold for contention, p90 latency,
stale-work, and audit-refutation rate. Capacity should decrease automatically
when extra concurrency makes service times or retries worse.

## 11. Risks and non-goals

- More concurrency can lower throughput through CPU/memory/cache contention.
- Speculation can convert idle time into discarded work; it needs a measured
  budget and invalidation rules.
- Composite width can inflate leaf-task/h if task sizes are not also reported.
- Small samples can confuse workload mix with scheduler improvement.
- Serial Land remains a deliberate correctness boundary; this proposal does
  not authorize multiple writers to the same integration target.
- The ranges in this document are not an SLA and do not justify skipping
  Prepare, Audit, Gate, full-suite, or later-generation evidence.
- DIR-124-E owns empirical calibration. If measurements refute these estimates,
  the measurements win and this model must be updated.
