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

## Re-scope (2026-10-14, human-directed via coordinator; supersedes the Plan/AC below that were written earlier the same day)
The human ruled that **16 GiB is a deliberate pressure constraint intended to drive test optimization; this task must not be completed by raising the cap (24/26 GiB).** Read-only diagnosis the same day also overturned this task's original premise:
- "peak pinned at MemoryMax" is the **normal** state. On 10-11 (14/42 runs) and 10-12 (12/53 runs) the peak sat at the cap with **zero** `oom_kill`.
- OOM kills are **recent** (rounds with evidence: 10-10 0/8, 10-11 0/42, 10-12 0/53, 10-13 3/25, 10-14 5/8), so this is a regression rather than a cap that was always too small.
- **Actual concurrency is 64**, not the `laneCount` 128 (= nproc). The scheduler caps total concurrency at the lowest active tier budget, `defaultPhaseConcurrency` = floor(nproc/(S×P)) = 64.

The runtime proof that 16 GiB holds (≥3 complete, OOM-free rounds) belongs to `gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison`. Completeness/OOM verdicts belong to `gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files`, and telemetry to `gap-suite-memory-telemetry-anon-file-shmem-swap-psi-concurrency-process-tree-unknown-not-zero`. This task no longer runs full-suite measurement rounds. A 26 GiB diagnostic run started under the old AC2 was stopped by the coordinator (artifacts: `quay-scratch/ac2-cap26-diagnostic-run-*`) and is diagnostic only.

## Plan
1. **16 GiB stays the default**, but stops being a code literal: it becomes a **project-declared, host-overridable** setting (`.quay/config.yml` suite knob + env override), resolved by the runner. A host-relative fraction stays as the **upper** bound, so a declared value is never above the host. No hardcoded paths; no dependency on another project.
2. The lane/per-file derivation may stay as a pure function with tests, but its concurrency input is the **actual measured concurrency** (per-file interval overlap from the round record, or the scheduler's own state), not nproc. It is recorded as a **diagnostic** next to the declared value. It must **never raise** MemoryMax above the declared value.
3. Record the human ruling chain (4G→6G→16G 2026-09-24; 16G kept as pressure baseline 2026-10-14) where the setting is declared.

## Acceptance Criteria
- [ ] AC1: pasted table of the last ≥10 full rounds with `peakBytes`, `memoryMax`, `oomKill`, fail count, **and the per-day oom_kill counts**, reported as "pinned is normal, OOM onset 10-13". It is not reported as "the cap is the cause".
- [ ] AC2: the effective MemoryMax on this host resolves to **16 GiB from the project declaration**. An env/host override changes it, and a declared value above the host fraction is clamped. On a fixture small host (e.g. 8 GB) the result never exceeds the host bound. All four readings pasted. No full-suite run is required for this AC.
- [ ] AC3: the derivation's concurrency input is the measured actual concurrency (pasted: the value the code reads for a real round, equal to the per-file interval max for that round). With this host's data the diagnostic is ~12 GiB (< 16). A unit test proves the diagnostic can never raise the effective MemoryMax above the declared value.
- [ ] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked. **No commit on this branch raises the effective default above 16 GiB** (`grep` of the resolved default + a test pinning it). Scoped vs full counts reported separately.

## Touches
- tasks/gap-suite-memorymax-literal-16g-cap-pinned-every-round-while-lanes-scale-with-nproc.md
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/full-suite-runner-types.ts
- packages/quay/src/systemd-scope.ts
- plugin/scripts/effective-capacity-probe.ts
- plugin/test/full-suite-runner-cgroup.test.mjs
