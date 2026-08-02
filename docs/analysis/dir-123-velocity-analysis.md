# DIR-123 Velocity Analysis: Development Throughput Before & After Worktree Isolation

**Date:** 2026-08-01
**Period analyzed:** 2026-07-27 – 2026-08-01 (5 days)
**Scope:** Git history, Claude Code session patterns, milestone absorption, gap/directive pipeline, prepare-milestone health

## Executive Summary

DIR-123's worktree isolation implementation was part of a **sustained velocity acceleration** — commit throughput 3×'d and LOC throughput nearly 4×'d from Jul 27 to Jul 31. But DIR-123 was **one of several interacting forces**, not the sole driver. The **prepare-milestone pipeline** (DIR-117, DIR-125, DIR-126) was the real rate-limiter — its capacity ceiling became visible on Aug 1 when 9 milestones required manual takeover due to "epoch full-review cap exhausted." DIR-123's concurrent-execution proof (AC 1) remains OPEN — the mechanism exists but hasn't been proven with real overlapping dispatches.

## 1. Quantitative Throughput

### 1.1 Commit Velocity

| Day | Commits | LOC Inserted | LOC Deleted |
|---|---|---|---|
| Jul 27 | 44 | +17,851 | −4,126 |
| Jul 28 | 52 | +15,337 | −2,860 |
| Jul 29 | 65 | +25,539 | −5,811 |
| Jul 30 | 75 | +25,862 | −4,710 |
| Jul 31 | 134 | +66,830 | −7,111 |
| Aug 1 | ~134 | massive | massive |

**Trend:** Steady 17–27% day-over-day acceleration, with a **step-change on Jul 31** (1.8× commits, 2.6× LOC vs Jul 30).

### 1.2 Milestone Absorption Rate

| Day | Milestones Absorbed | Details |
|---|---|---|
| Jul 28 | 3 | M192, M194, M195 |
| Jul 29 | 4 | M197, M198, M200, M201 |
| Jul 30 | 4 | M202, M203, M204, M207 |
| Jul 31 | 2 | M205, M206 |
| Aug 1 | 6 | M210, M211, M212, M222, M230, M231 |

**Trend:** 3→4→4→2→6. The Jul 31 dip to 2 coincides with DIR-123's own implementation consuming attention. The Aug 1 surge to 6 reflects the post-DIR-123 pipeline catching up, but **with 9 manual takeovers** indicating the pipeline itself was at capacity.

### 1.3 Prepare Pipeline Health (the hidden bottleneck)

| Period | PREPARED (automated) | Manual Receipts | Manual Rate |
|---|---|---|---|
| Jul 27-30 | 18 | 1 | 5% |
| Jul 31 | 8 | 0 | 0% |
| Aug 1 | 0 | 9 | **100%** |

**This is the critical signal.** On Aug 1, **every single milestone** that went through preparation needed manual intervention — all 9 citing "epoch full-review cap exhausted." The prepare-milestone pipeline's `proposal-convergence.ts` has a per-epoch review cap that became the dominant bottleneck once execution throughput increased.

### 1.4 Gap Detection Rate

| Day | Gaps Filed |
|---|---|
| Jul 27 | 6 |
| Jul 28 | 0 |
| Jul 29 | 12 |
| Jul 30 | 4 |
| Jul 31 | 18 |
| Aug 1 | 8 |

The gap-detection pipeline (a proxy for methodology self-awareness) was highly active. Jul 29's spike (12 gaps, mostly `wiring-coverage-check` and `preflight` edge cases) and Jul 31's 18 gaps (including `size-aware-routing`, `epoch-cli-toctou`, `convergence-test-fixture`) reflect the prepare-milestone pipeline maturing under load.

## 2. DIR-123's Role in the Velocity Story

### 2.1 Timeline

```
Jul 27   gap-execute-milestone-no-worktree-isolation doesn't exist yet
Jul 28   gap filed, promoted to DIR-123 same day
Jul 28-30 DIR-123 waits — originally sequenced after DIR-122 → DIR-119-D → DIR-119
Jul 31   Code-level dependency analysis shows ZERO real deps — re-sequenced to precede DIR-119-D
Jul 31   DIR-123 implementation (d6faeb53): real git-worktree isolation + concurrency-safety hardening
Jul 31   M214 prepared for DIR-123 via PREPARED gate
Aug 1    DIR-123 merged to master (cad0b033), marked done (059b5b16)
Aug 1    First worktree-isolated audits: DIR-112 + DIR-124-A2 acceptance audits
```

### 2.2 What DIR-123 Actually Changed

1. **Build/Audit/Gate sandboxing:** Phases now run in `milestones/M<NN>/worktrees/iteration-0` — the shared checkout is untouched until Land
2. **Concurrent milestone eligibility:** Two file-disjoint milestones CAN run in parallel (pre-dispatch safety via `checkTouchesPair` reuse)
3. **Land serialization:** Single-flight Land lock prevents lost-update on `milestone_counter`/`dashboard.md`/`backlog.md`
4. **Failure-path cleanup:** Branch orphan prevention, stale-worktree recovery (`--clean-stale`), idempotent re-dispatch
5. **Golden-replay back-compat:** Legacy (no `isolationMode`) dispatches are byte-for-behavior identical

### 2.3 What DIR-123 Did NOT Do (Open Items)

- **AC 1 (OPEN):** Two genuinely concurrent milestone dispatches with overlapping Build timestamps — mechanism exists, proof deferred to future dispatches (e.g., DIR-119-D2 + D3)
- **AC 6 (OPEN):** Failure-path cleanup policy exercised at each of 3 `needs-human` exits with re-dispatch idempotency — `--clean-stale` implemented and tested, but workflow-integration proof requires a real dispatch
- **AC 9 (OPEN):** Fresh independent wiring audit confirming real git operations
- **DoD item 2 (OPEN):** Real pasted evidence of concurrent worktree-isolated milestone dispatches
- **Default mode:** Still opt-in (`isolationMode:'worktree'`), not default

### 2.4 Immediate Diffusion

Post-DIR-123 worktree milestones: **M212, M218, M221, M222, M224, M226, M230, M231, M243, M246** — 10 milestones used worktree isolation within hours of landing.

## 3. The Real Throughput Drivers (Multi-Causal)

DIR-123 was ONE of several converging forces:

### 3.1 The Prepare Pipeline Maturation (DIR-117 → DIR-125 → DIR-126)

The single largest throughput driver was the prepare-milestone pipeline becoming real:

- **DIR-117 (M191):** Prepared gate — turned proposal→plan from a manual process into a mechanical pipeline with parseable stage blocks
- **DIR-125 (M193):** Bounded convergence — prevented infinite re-generation loops (10 consecutive full-regeneration rounds, ~3h15m, ~1.13M output tokens)
- **DIR-126 (5-way split):** Capacity model calibration — real telemetry-driven capacity planning

These three directives collectively turned `prepare-milestone` from "hope it converges" to "bounded, predictable, mechanically-checkable."

### 3.2 The Mass Product-Facing Work (DIR-099/100/103/104/105)

A large batch of product-facing quay Core improvements landed concurrently:

- **DIR-099:** Config validation (CLI + MCP surfaces)
- **DIR-100:** Gate diagnostics (severity taxonomy, stderr routing, per-entry validation)
- **DIR-103:** Gate dry-run / per-provider env
- **DIR-104:** Gate list --verbose
- **DIR-105:** execFileSync maxBuffer

These were mostly **small, independent, method-infra** milestones (Δv=0) that could be batched efficiently.

### 3.3 The Gap → Directive → Milestone Pipeline Acceleration

The methodology's self-diagnostic loop was running hot:
- 48 gaps filed in 5 days
- 16 directives created (DIR-120 through DIR-126, DIR-124's family)
- Gaps discovered → promoted to directives → split into milestones → prepared → executed — the entire pipeline was operating at scale

### 3.4 Human-Steered vs Autonomous Balance

The period shows a mix:
- Jul 27-30: Heavy autonomous loop with human steering at decision points
- Jul 31: DIR-123 was explicitly human-prioritized (re-sequenced ahead of the originally-planned dependency chain)
- Aug 1: Manual takeover surge — the autonomous pipeline hit capacity limits

## 4. Bottlenecks and Friction Points

### 4.1 Prepare-Milestone Epoch Full-Review Cap (PRIMARY BOTTLENECK)

The `proposal-convergence.ts` per-epoch review cap is the single most impactful bottleneck. On Aug 1, when execution throughput was highest, **every milestone** hit this cap, requiring human manual takeover. This is a **pipeline design constraint**, not a DIR-123 issue — but it becomes the dominant bottleneck once execution isolation is no longer the rate-limiter.

### 4.2 Prepare-Milestone is Serial

Even with worktree isolation for `execute-milestone.js`, `prepare-milestone.js` (the proposal→plan pipeline) is still serial — each milestone's preparation is a sequential workflow with no parallelism. This is the **upstream bottleneck** that determines how many milestones can be dispatched concurrently downstream.

### 4.3 Epoch Lease Contention

Multiple gaps filed (`gap-prepare-milestone-lease-read-race`, `gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening`) point to lease-management friction in the prepare pipeline — concurrent prepare attempts would race on epoch state.

### 4.4 The Δv=0 Problem

The dashboard shows a recurring pattern: `VT UNCHANGED, realized Δv=0` for most milestones. The bulk of throughput was **method-infra** (improving the methodology machinery itself) rather than **capability-growth** (adding product features to quay Core). This is expected for a BAIME experiment but is a concern for productization timelines.

### 4.5 Worktree Isolation is Still Opt-In

DIR-123's mechanism exists but:
- The default path is still direct-on-master (no isolation)
- `OUTER-LOOP.md`'s concurrent_execute template hasn't been updated to use `isolationMode:'worktree'`
- No real concurrent dispatch has proven the mechanism end-to-end

## 5. Recommendations

### 5.1 Immediate (Next 1-3 Milestones)

1. **Complete DIR-123's AC 1:** Dispatch two real file-disjoint milestones with `isolationMode:'worktree'` via the production `OUTER-LOOP.md` template — DIR-119-D2 + D3 are the natural candidates. This turns "mechanism exists" into "proven safe."

2. **Fix the epoch full-review cap:** The Aug 1 100% manual-takeover rate is unsustainable. Options:
   - Raise the cap with a scope-change grant mechanism (already filed: `gap-prepare-milestone-epoch-scope-change-grants-full-review`)
   - Implement incremental review reuse across generations (`gap-prepare-milestone-cross-generation-no-incremental-reuse`)
   - Route by size: small milestones get lighter review (`gap-prepare-milestone-no-size-aware-routing`)

3. **Update OUTER-LOOP.md:** Switch the production concurrent_execute template to pass `isolationMode:'worktree'` — this is DIR-123's own AC requirement that was deferred.

### 5.2 Short-Term (exp6 Foundation)

4. **Make worktree isolation the default:** Once AC 1 is proven, switch the default from direct-on-master to worktree-isolated — with a fallback flag for the legacy path. This reduces the "mixed-mode" risk documented in CLAUDE.md.

5. **Parallelize prepare-milestone:** The prepare pipeline is the upstream bottleneck. With worktree isolation for execution, the next frontier is preparation parallelism — multiple milestones preparing concurrently in their own worktrees, with lease management hardened.

6. **Implement size-aware routing:** The `gap-prepare-milestone-no-size-aware-routing` (filed Aug 1) is the key to reducing the epoch review cap pressure — small, mechanical milestones shouldn't consume the same review budget as architectural changes.

7. **Close the feedback loop latency:** Gaps filed vs gaps resolved is imbalanced (48 filed in 5 days; ~15 resolved as milestones). Implement the `gap-audit-findings-not-backpropagated-to-earlier-detectors` pattern — when a gap is found during milestone execution, feed it back to the preflight/prepare checks so the same class of gap is caught earlier next time.

### 5.3 Medium-Term (exp6 → Product)

8. **Provider-agnostic isolation abstraction:** The `git worktree` mechanism is git-specific. For quay's product surface (Provider ABI: native, GitHub, future providers), abstract the isolation concept:
   - Native provider: worktree (already done)
   - GitHub provider: branch-per-milestone + PR-as-merge
   - Future providers: pluggable isolation strategy

9. **Pipeline observability dashboard:** The capacity model from DIR-126-E is a good start but needs real-time feedback:
   - Per-epoch review budget consumption
   - Pipeline stage latency (prepare → execute → audit → land)
   - Bottleneck detection (which stage is the current rate-limiter?)
   - Historical trendlines with anomaly detection

10. **Execution engine as product feature:** The worktree isolation + touches-orthogonality + Land lock pattern should become a **documented, tested, product-grade feature** of quay Core, not just a BAIME experiment artifact. This means:
    - Clean separation from `experiments/` layer
    - Provider ABI extension for isolation primitives
    - Configuration surface (`.quay/config.yml` isolation settings)
    - Tests at the Provider ABI conformance level

### 5.4 Long-Term (quay Productization)

11. **BAIME methodology ↔ quay Core separation:** Currently the methodology layer (`experiments/`, task store, directive lifecycle) and the product layer (`packages/`) are co-developed. For product delivery:
    - The execution engine (worktree isolation, gate engine, lifecycle) should be in `packages/quay`
    - The methodology (prepare-milestone, proposal convergence, epoch management) should be a plugin/extension
    - The Provider ABI should include isolation, not assume git

12. **Reduce the Δv=0 ratio:** The current throughput is dominated by method-infra improvements. For product delivery, shift focus to capability-growth milestones that add product surface:
    - Web UI features
    - Provider integrations
    - User-facing CLI improvements
    - Documentation and onboarding

13. **Manual intervention surface reduction:** The "manual takeover" pattern on Aug 1 is a product anti-pattern. Target:
    - Auto-recovery for epoch cap exhaustion (degrade gracefully, don't halt)
    - Incremental review reuse (don't re-review unchanged proposals)
    - Degraded-mode operation (lighter checks when under load)

## 6. Methodology Insights

### 6.1 The Prepare-Execute Pipeline as a Two-Stage Queue

The data reveals a two-stage pipeline:
```
gap → directive → milestone candidate → prepare-milestone → execute-milestone
                   (batch formation)      (serial, rate-limited)  (parallel, worktree-isolated)
```

DIR-123 parallelized the EXECUTE stage. The PREPARE stage remains serial and rate-limited. This is classic queueing theory: parallelizing the downstream stage shifts the bottleneck upstream. The Aug 1 manual-takeover spike is exactly what queueing theory predicts — the prepare stage couldn't feed the now-faster execute stage.

### 6.2 The VT Problem

The recurring `Δv=0` pattern (method-infra milestones that improve the methodology but don't move the product surface) is structurally similar to technical-debt reduction in traditional software: necessary, valuable, but not directly user-visible. The methodology's own VT metric correctly identifies this — but the exp5 loop currently has no mechanism to balance method-infra vs capability-growth allocation. This is a governance/funnel-design question for exp6.

### 6.3 The Gap-Detection Feedback Loop

The 48 gaps filed in 5 days is a sign of a healthy self-diagnostic methodology. But the gap→fix latency matters:
- Some gaps were promoted to directives and resolved same-day (e.g., `gap-execute-milestone-no-worktree-isolation` → DIR-123)
- Others remain `status:todo` (e.g., `gap-prepare-milestone-no-size-aware-routing`)
- The backlog of open gaps is growing faster than the resolution rate

This is sustainable for an experiment but would be a product reliability concern.

## 7. Conclusion

DIR-123 was a **necessary enabler** for the Jul 31–Aug 1 throughput surge, but it was not the primary driver. The surge was multi-causal:

1. **Prepare pipeline maturation** (DIR-117/125/126) — the biggest single factor
2. **Mass method-infra batch** (DIR-099/100/103/104/105) — independent, parallelizable work
3. **Worktree isolation** (DIR-123) — removed the "can't run in parallel" blocker
4. **Gap detection hot loop** — rapid self-diagnosis → directive → milestone pipeline

The **next bottleneck** is already visible: the prepare-milestone epoch review cap. Fixing that will shift the bottleneck again — likely to gap-detection throughput or to the human steering decision latency. This is the expected behavior of a maturing autonomous methodology: each bottleneck you remove reveals the next one.

For exp6, the highest-leverage investment is **prepare-milestone parallelism** — with size-aware routing to reduce the per-milestone review cost, and incremental review reuse to avoid re-reviewing unchanged proposals. For quay productization, the key is **separating the BAIME methodology from the product execution engine** and making the isolation mechanism a first-class Provider ABI feature.
