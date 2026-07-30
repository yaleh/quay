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

The flat **15–25 minute** planning range this section previously asserted —
generalized from a single DIR-117 observation (**22m 21s**) with no supporting
distribution, sample count, or provenance — is **retired**. It is replaced by
the reproduced, reproducible distributions below, generated by the read-only
aggregation mode DIR-126-E added to the preparation checker:

```bash
node experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts \
  --capacity-report --telemetry-glob 'milestones/prepare-telemetry/**/*.json' --workspace .
```

The mode reads ONLY checked-in artifacts — `milestones/prepare-telemetry/**/*.json`
telemetry records (DIR-126-D's landed writer) and `milestones/M*/preparation.json`
receipts (DIR-125's landed instrumentation) — never Claude Code session JSONL.
Its output is byte-reproducible across re-runs (no generation timestamp), so
every figure below is mechanically re-derivable from the tree.

**Two wall-time distributions, never pooled** (they measure semantically
different intervals; one blended P50/P85 would fabricate a statistic neither
source supports). As of this regeneration (DIR-126-E build; the tree is
deliberately a moving target — the command reproduces whatever the current tree
holds):

```text
Telemetry proxy (admission.acquiredAt → recordedAtMs; lease-acquire → record-write)
  n = 26 | min 0.8m | P50 29.1m | P85 58.8m | max 77.2m   (nearest-rank)

Receipt prepareWallTimeMs (full prepare loop incl. PlanCheck;
via computeConvergenceMetrics on convergence-bearing, non-degenerate receipts)
  n = 3  | min 14.3m (M206) | P50 20.9m (M200) | P85 = max 219.3m (M198)   (nearest-rank)
```

The old 15–25 minute band covers roughly the fastest quartile of real
generations: its upper bound sits below the telemetry-proxy P50 (29.1m), and
the receipt-side tail (M198, 219.3m — the human-steered DIR-119-D1 generation
whose ~80-minute PlanCheck tail DIR-126's parent Finding first measured) is
nearly 9× above it.

**Sample provenance** (every ID below is locatable on disk; 26 telemetry
records across 4 task directories, plus 3 receipts):

```text
milestones/prepare-telemetry/DIR-126-E/:
  18d336692269 2a107fcb5cc9 2b801a8792aa 454f7ead5eb4 46fa645e89b9 64ed98bf7306 7bf870b7fe95
milestones/prepare-telemetry/gap-dir126d-deferred-phase-timing-recurrence-tracking/:
  86de375b56db ca5bb88535f7 dd06ce1ed5b8 e58d5b1ac2d2 ffc333d19352
milestones/prepare-telemetry/gap-prepare-milestone-split-decision-no-finality/:
  0eba810e4ccb 30b57d372e50 31161d095578 9e892ae0acee c2ae58fd6875 ef57a199607a
milestones/prepare-telemetry/gap-wiring-coverage-check-whose-own-and-bold-marker-splitting/:
  06ae2770b33b 0757190aed41 280d286beda8 29fefa2d9d6e 2fe141fdc3da 54922b2aeb26 bca971f8c0b8 f13f08a032f3
receipts: milestones/M198/preparation.json  milestones/M200/preparation.json  milestones/M206/preparation.json
```

**Exclusions (always reasoned, nothing dropped silently):** 8 receipts excluded
from wall-time stats — M192, M195, M204 as `convergence-interval-degenerate`
(`startedAtMs === endedAtMs` placeholder timestamps; the guard that keeps M195's
real ~80-minute generation from silently reporting `0ms`), and M197, M201, M202,
M203, M207 as `no-convergence-block` (pre-DIR-125 receipts). No telemetry
exclusions in this run.

**Yield and waste classes (same run):** 26 attempts, `prepared/attempt` = 0.077
(2 `Receipt/prepared`; 22 split/preflight-recommended; 2 transient failure)
across 6 distinct terminal shapes; `cold` 18 / `resume` 8 / `reuse-terminal` 0.
Concurrent duplicate-generation minutes: **0** across all four `admission.key`
overlap groups (DIR-126-A's lease enforcement observed working). Unchanged-
terminal recomputations: **0**; terminal-reuse hits: **0**.

**Absorption:** `absorbed-task/prepare-hour` = 9 absorbed tasks / 4.004
prepare-hours (denominator = summed receipt wall time over the convergence-
bearing, non-degenerate absorbed receipts M198 + M200) ≈ **2.25 absorbed
task/prepare-hour** — from checked-in file presence (`preparation.json` ∧
`absorb-entry.md`) only, zero live provider queries.

**Honest limits of this reading** (disclosed, not smoothed over):

- **Headline durations are wall time, not agent-minutes.** `contentAgentMs` is
  `null` for all 26 live `cold`/`resume` records under the frozen
  `schemaVersion: 2` — reported as `notMeasured` (26/26), never coerced to 0.
  The supplementary `wallTimeProxyMinutes` total (904.2m) is labeled as a proxy,
  never presented as content-agent work. `estimatedAvoidedAgentMinutes` is the
  literal `"unknown"` — no comparable measured population exists to estimate
  against, and savings are never fabricated.
- **No real `reuse-terminal` sample exists yet (0/26).** The reuse path's
  zero-content-agent claim is exact and schema-guaranteed but not yet witnessed
  by live data; this is a residual open item against DIR-126-E's DoD, to be
  closed when a real `reuse-terminal` generation lands, never synthesized.
- The receipt-side distribution is thin (n = 3) — the telemetry proxy carries
  the population weight until more receipts record real convergence intervals.

Simply prepending Prepare to the old serial workflow would now produce:

```text
70.5 historical delivered-task minutes + 29.1m Prepare (telemetry-proxy P50)
≈ 100 minutes per task ≈ 0.60 task/h
70.5 + 58.8m (P85) ≈ 129 minutes ≈ 0.46 task/h
```

A practical early range might be 0.45–0.65 task/h as caching and task mix vary,
a larger regression than the retired 15–25 minute assumption implied.
Therefore DIR-124-E must overlap Prepare with other candidates' Build/Audit.
Pipelining only Verify, Build, and Audit leaves a new ~29–59 minute serial head
stage (P50–P85, worst observed case ~219m) and cannot meet the intended
throughput gain.

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
