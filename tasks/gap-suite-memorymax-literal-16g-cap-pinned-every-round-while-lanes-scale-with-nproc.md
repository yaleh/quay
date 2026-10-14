---
id: gap-suite-memorymax-literal-16g-cap-pinned-every-round-while-lanes-scale-with-nproc
title: 套件 MemoryMax 仍是写死的 16G 上限而 lane 随 nproc=128 增长：近 16 轮 15 轮顶满、9/12 红、7 轮
  OOM kill，全靠 rerun-green 洗成 flake
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Root cause of the rotating full-suite reds on the 128-core host, measured 2026-10-14.** For rounds 2645-2660 (`.quay/verification-round.jsonl` joined with `.quay/suite-memory-evidence-<runId>.json`), suite cgroup `peakBytes` reached **16.0 GiB (= MemoryMax 17179869184) in 15 of 16 rounds**, greens included. 9 of the last 12 rounds were recorded red, with failure counts 1, 4, 4, 1, 15, 4, 13, 12, 1, 6. 7 rounds had `oomKill>0` (`oom` events up to 22673). Round 2660's kills removed 89% of the run's files (filed separately: `gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files`). Rounds 2658/2659, which the human asked about: 2658 = 1 fail (`resource-gate-s08` AC5, a 10.0s timing assertion, peak 16.0 GiB, oomKill 0); 2659 = 6 fails across 4 files (`build-plugin-dist` AC5/AC1, `quality-gate-driver` AC1(b) timeout, `full-suite-runner-s07` AC2 e2e red-grace, `shipped-set` AC2 control), peak 16.0 GiB, oomKill 2. All of them landed through `rerun-green` (the named files re-run in isolation pass). So the memory ceiling has been laundered into "load flakes" round after round.

**Cause (`full-suite-runner.ts:994-1052`).** `memoryMax = min(floor(effective_total_mem × 0.25), 16G)`. The 16G cap is a **written-down literal** (human ruling 2026-09-24, raised from 6G when the 6G literal produced the same symptom; see that ruling's own warning that 16G "is still a literal"). On this 246 GB host the 25% rule yields ~61 GB, but the literal caps it at 16 GiB, while lane count is derived from the host (`laneCount` 127-128 = nproc). Concurrency scales with the host and memory does not (硬规则 4 推论二). Per-file peak memory in these rounds: p50 ≈ 64-73 MB, max ≈ 1.74-2.27 GB. At 128 concurrent lanes that sum routinely exceeds 16 GiB.

## Plan
1. Replace the literal ceiling with a derivation that keeps the two halves consistent. Either derive MemoryMax from `lanes × measured per-file memory (high percentile) + headroom`, bounded by the host-derived 25% (or 50%) rule, or bound **lanes** by available MemoryMax / per-file percentile. Pick one and give the reason. The per-file `memPeakKb` the runner already records is the measurement source (no new instrument).
2. This changes a value a human ruled (16G, 2026-09-24). The task records that ruling and states plainly that the derivation supersedes the literal. It is not a silent bump. If the derivation would exceed the human's stated intent (a guardrail against runaway suites), keep a host-relative guardrail (fraction of effective memory), not an absolute literal.
3. No change to test content and no new rerun allowances.

## Acceptance Criteria
- [ ] AC1: before the fix, pasted table of the last ≥10 full rounds with `peakBytes`, `memoryMax`, `oomKill`, fail count. Reproduces the "pins the cap" reading on the current develop.
- [ ] AC2: after the fix, ≥3 consecutive real full `scripts/test.sh` runs on develop (exact commit, scope=full, file count ≈ scheduled count, test count ≈ 7,880 pasted) with `peakBytes < memoryMax` and `oomKill = 0`. Their fail counts are pasted as they are, not filtered.
- [ ] AC3: the derivation is a pure function with tests across host shapes (small 4-core/8 GB, this 128-core/246 GB), and MemoryMax never exceeds the host-relative guardrail (pasted).
- [ ] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked. Report scoped vs full counts separately. A scoped green is not cited as a full-suite result.

## Touches
- tasks/gap-suite-memorymax-literal-16g-cap-pinned-every-round-while-lanes-scale-with-nproc.md
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/full-suite-runner-types.ts
- packages/quay/src/systemd-scope.ts
- plugin/scripts/effective-capacity-probe.ts
- plugin/test/full-suite-runner-cgroup.test.mjs
