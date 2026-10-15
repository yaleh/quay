---
id: gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison
title: 16GiB 压力基线下：重型测试文件优化 + 内存感知调度 + 32/48/64 实际并发同 commit 完整轮对比（不足才比 20/24）
status: needs-human
labels:
  - gap
parent: null
children: []
extra: {}
depends_on:
  - gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files
  - gap-suite-memory-telemetry-anon-file-shmem-swap-psi-concurrency-process-tree-unknown-not-zero
  - gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping
  - gap-quality-gate-driver-loop-watchdog-test-hangs-since-e18ec4b04
  - gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls
---
## Proposal
**Human direction 2026-10-14: the 16 GiB suite MemoryMax is a deliberate pressure constraint meant to drive test optimization. It must not be "fixed" just by raising it to 24/26 GiB.** This task does the optimization and the controlled concurrency comparison under 16 GiB. Only if that comparison shows 16 GiB cannot hold does it compare 20/24.

**Measured inputs (read-only diagnosis, same day):**
- **OOM history under 16 GiB** (136 runs with evidence, 10-10 12:16 → 10-14 08:48Z): 10-10..10-12 **0/103 runs with oom_kill**. 10-13 3/25 runs (162 OOM events). 10-14 5/8 runs (74,499 events). 19 kills total, all in phase `main`. The onset is recent. It does not track test-process RSS: the summed concurrent per-file peak median was 12.3/11.9 GiB on 10-13/14, against 14.9/13.6 GiB on the OOM-free 10-11/12.
- **Heavy files** (self-RSS max over the last 5 full rounds):
  - `packages/quay/test/gap-dashboard-goal-card-ac-denominator-includes-superseded-retired.test.mjs` 1777 MB / 4.6s
  - `plugin/test/ac260-ac261-delivery-face-ref-source.test.mjs` 1769 MB / 8.7s
  - `plugin/test/ac341-post-merge-promotion-events-dialect.test.mjs` 1761 MB / 38.1s. **First seen 10-12T20:52, the only heavy file that is new before the OOM onset.**
  - `plugin/test/ac272-rolling-channel-version-selfproof.test.mjs` 1754 MB / 30.3s
  - `plugin/test/workflow-runner-self-hosted-check.test.mjs` 1186 MB
  - `packages/quay/test/lanes-cli.test.mjs` 726 MB
  - `plugin/test/writestate-atomicity-split-s02.test.mjs` 662 MB
  - `plugin/test/prod-data-audit.test.mjs` 596 MB / 54.8s

  11 files exceed 300 MB. p50 71 MB, p95 157 MB, p99 662 MB.
- **Actual concurrency is 64**, not the `laneCount` 128 the round records.
- **Hypothesis, untested:** ac341 plus a nearly full shared host swap (28.7/32 GiB) tipped the main phase into OOM. Counterfactual needed: the same commit with ac341 isolated or removed.

## Plan
1. **Heavy-file optimization first.** For each file above 1 GB: find what holds the memory (whole-carrier reads, unbounded fixture generation, in-process loading of large modules) and reduce it without weakening the test's assertion. Start with ac341.
2. **Memory-aware scheduling.** Files with a measured high-water above a project-declared threshold go to a bounded "heavy" bucket, so they never co-run beyond a declared count. The declaration lives in the project's own config (`.quay/config.yml` loop section, or the test-group declaration mechanism), is read by the runner, and is overridable per host. No hardcoded paths. No dependency on another project's resources.
3. **Controlled comparison, same commit, complete sets.** At MemoryMax 16 GiB, run phase concurrency **32 / 48 / 64**, each for **≥3 complete rounds**, all on the same commit, and record for each:
   - files planned = files terminal (from the completeness task);
   - tests;
   - oom_kill;
   - peak anon/file/shmem/swap (from the telemetry task);
   - phase wall times;
   - leaked processes = 0 (from the lifecycle task).

   **These runs are deliberate measurement runs, scheduled by the driver in quiet slots, not stacked on top of live fan-ins.** Only if no concurrency at 16 GiB achieves 3/3 complete, OOM-free rounds, repeat the best concurrency at 20 then 24 GiB, and state which constraint failed.
4. The policy chosen is recorded as a project declaration, with the measurements that justify it. The gate that enforces completeness stays independent of the memory policy.

## Acceptance Criteria
- [ ] AC1: ac341 counterfactual: same commit, ac341 isolated vs included, at 64-way under 16 GiB, ≥2 rounds each. oom_kill and peak anon pasted. The hypothesis is stated as supported or refuted.
- [ ] AC2: heavy-file changes with before/after self-RSS and duration per file (pasted). No assertion weakened (diff of asserts pasted per file).
- [ ] AC3: the 16 GiB comparison table, 32/48/64 × ≥3 complete rounds each (commit, planned=terminal counts, tests, oom_kill, peaks, wall times, leaked=0), pasted in full. Any 20/24 rows appear only if AC3's 16 GiB rows show no viable setting, and say why.
- [ ] AC4: the chosen setting is a project-declared, host-overridable configuration (not a code literal, not a path), with the table cited as its basis.
- [ ] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence. MemoryMax baseline stays 16 GiB unless AC3 proves otherwise.

## Touches
- tasks/gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison.md
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/suite-params.ts
- plugin/scripts/suite-scheduler.ts
- scripts/test.sh
- packages/quay/src/goal-store.ts
- plugin/test/suite-params.test.mjs
- plugin/test/suite-scheduler.test.mjs
- plugin/test/ac341-post-merge-promotion-events-dialect.test.mjs
- plugin/test/ac260-ac261-delivery-face-ref-source.test.mjs
- plugin/test/ac272-rolling-channel-version-selfproof.test.mjs
- packages/quay/test/gap-dashboard-goal-card-ac-denominator-includes-superseded-retired.test.mjs
- plugin/test/workflow-runner-self-hosted-check.test.mjs

## Blocker

**2026-10-15T21:08:47.586Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 2/5，剩余未勾 3）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：8f6ea38f-3f92-4864-83ca-cce156885573

## Needs-Human

**执行 2026-10-15T21:15:46.271Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：AC 未全勾（checked 2/5，剩余未勾 3）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：e7b51858-02c8-47b5-baa1-9040d5172010
