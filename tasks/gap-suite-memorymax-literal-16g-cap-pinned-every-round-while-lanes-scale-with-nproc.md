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

**What was landed (all four ACs below):** the 16 GiB ceiling stops being a code literal — it is now a **project-declared** (`.quay/config.yml` `suite: memory_max:`), **host-overridable** (`QUAY_SUITE_MEMORY_MAX`) setting, with the host-relative fraction as the **upper** bound; the human ruling chain is recorded at the declaration site. ⛔ No commit on this branch raises the effective default: it resolves to exactly 16 GiB on this host, pinned by a test.

## Plan
1. **16 GiB stays the default**, but stops being a code literal: it becomes a **project-declared, host-overridable** setting (`.quay/config.yml` suite knob + env override), resolved by the runner. A host-relative fraction stays as the **upper** bound, so a declared value is never above the host. No hardcoded paths; no dependency on another project.
2. The lane/per-file derivation may stay as a pure function with tests, but its concurrency input is the **actual measured concurrency** (per-file interval overlap from the round record, or the scheduler's own state), not nproc. It is recorded as a **diagnostic** next to the declared value. It must **never raise** MemoryMax above the declared value.
3. Record the human ruling chain (4G→6G→16G 2026-09-24; 16G kept as pressure baseline 2026-10-14) where the setting is declared.

## Acceptance Criteria
- [x] AC1: pasted table of the last ≥10 full rounds with `peakBytes`, `memoryMax`, `oomKill`, fail count, **and the per-day oom_kill counts**, reported as "pinned is normal, OOM onset 10-13". It is not reported as "the cap is the cause".

  Last 12 rounds (read-only join of `.quay/verification-round.jsonl` × `.quay/suite-memory-evidence-<runId>.json`):

  | round | at (UTC) | lanes | files | tests | fail | peakBytes | memoryMax | peak==max? | oom/oomKill |
  |---|---|---|---|---|---|---|---|---|---|
  | 2650 | 2026-10-13T17:38:22Z | 127 | 579 | 7847 | 4 | 14.28 GiB | 16.00 GiB | no | 0/0 |
  | 2651 | 2026-10-13T17:55:03Z | 127 | 579 | 7847 | 1 | 16.00 GiB | 16.00 GiB | YES | 0/0 |
  | 2652 | 2026-10-13T18:20:20Z | 127 | 579 | 7843 | 15 | 16.00 GiB | 16.00 GiB | YES | 32/3 |
  | 2653 | 2026-10-13T18:33:37Z | 127 | 579 | 7853 | 4 | 16.00 GiB | 16.00 GiB | YES | 126/2 |
  | 2654 | 2026-10-14T03:11:30Z | 127 | 579 | 7865 | 13 | 16.00 GiB | 16.00 GiB | YES | 11060/2 |
  | 2655 | 2026-10-14T04:00:48Z | 127 | 579 | 7870 | 12 | 16.00 GiB | 16.00 GiB | YES | 1/1 |
  | 2656 | 2026-10-14T04:06:40Z | 128 | 579 | 7871 | 0 | 16.00 GiB | 16.00 GiB | YES | 0/0 |
  | 2657 | 2026-10-14T06:50:52Z | 128 | 579 | 7875 | 0 | 16.00 GiB | 16.00 GiB | YES | 0/0 |
  | 2658 | 2026-10-14T07:23:12Z | 127 | 579 | 7879 | 1 | 16.00 GiB | 16.00 GiB | YES | 0/0 |
  | 2659 | 2026-10-14T07:45:48Z | 127 | 579 | 7883 | 6 | 16.00 GiB | 16.00 GiB | YES | 7/2 |
  | 2660 | 2026-10-14T07:54:05Z | 128 | 65 | 466 | 0 | 16.00 GiB | 16.00 GiB | YES | 22673/4 |
  | 2661 | 2026-10-14T08:46:28Z | 126 | 65 | 407 | 0 | 16.00 GiB | 16.00 GiB | YES | 40758/4 |

  ⇒ rounds=12, pinned-at-memoryMax=11, with-oomKill>0=7.

  **Per-day onset** (every round that has cgroup evidence):

  | day | rounds with cgroup evidence | `oom_kill > 0` | `peak >= memoryMax` |
  |---|---|---|---|
  | 2026-10-10 | 8 | 0 | 0 |
  | 2026-10-11 | 42 | 0 | 14 |
  | 2026-10-12 | 53 | 0 | 12 |
  | 2026-10-13 | 25 | 3 | 13 |
  | 2026-10-14 | 8 | 5 | 8 |

  **Reading: "pinned is normal, OOM onset 10-13".** 10-11 and 10-12 sat at the cap (14/42 and 12/53 of the runs) with **zero** `oom_kill` — a cgroup's `memory.peak` includes reclaimable page cache, so filling the cap is the normal state, and the cap is **not** the cause of the reds. The OOM kills onset on 10-13 and intensify on 10-14: that is a regression to be found (a heavy file is the leading suspect — `gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison`), not a chronically-small cap. ⛔ The 2026-10-14 re-scope also killed AC1's original framing, and this AC no longer claims the literal was the cause.

- [x] AC2: the effective MemoryMax on this host resolves to **16 GiB from the project declaration**. An env/host override changes it, and a declared value above the host fraction is clamped. On a fixture small host (e.g. 8 GB) the result never exceeds the host bound. All four readings pasted. No full-suite run is required for this AC.

  Readings from the REAL exported functions (run against this branch's committed tree):

  **(1) this host, no override — the declared 16 GiB**
  ```
  resolveSuiteMemoryMax(<fresh state dir>):
    effectiveMemoryMax = "17179869184"  = 16.00 GiB
    declared = "16G"   declaredSource = "default"   bound = "declared"
    hostGuardBytes = 27917287424 = 26.00 GiB   (the declared value is BELOW it ⇒ honoured, not raised)
  DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax = 17179869184 = 16.00 GiB
  defaultSuiteMemoryMax()              = 17179869184 = 16.00 GiB
  ```
  Declaration site (`.quay/config.yml`, env-promoted so config < env): `suite: memory_max: "16G"` → `QUAY_SUITE_MEMORY_MAX`. The ruling chain is recorded there and at `SUITE_MEMORY_MAX_DEFAULT`: 4G → 6G (2026-08-12, 4-core box) → **16G (人 2026-09-24)**; 16G kept as the pressure baseline (人 2026-10-14).

  **(2) an override CHANGES the effective ceiling**
  ```
  QUAY_SUITE_MEMORY_MAX=2G   -> 2147483648  = 2.00 GiB   (bound=declared)
  QUAY_SUITE_MEMORY_MAX=20G  -> 21474836480 = 20.00 GiB  (bound=declared)
  declaredSuiteMemoryMax("8G")        = {"value":"8G","source":"env"}
  declaredSuiteMemoryMax(undefined)   = {"value":"16G","source":"default"}
  ```
  ⇒ the value is declared, not compiled in: two declarations give two ceilings.

  **(3) a declared value ABOVE the host fraction is CLAMPED**
  ```
  declare 16G, host bound 2 GiB  ->  2147483648 = 2.00 GiB   (bound=host-guard)
  reason: the declared ceiling (16G = 17179869184 B) exceeds the host-relative guardrail
          (2147483648 B = 0.25 × the effective host total) — the host guard is the binding runaway bound
  ```

  **(4) fixture small host (8 GB) — never exceeds its bound**
  ```
  8 GiB effective host  ->  2147483648 = 2.00 GiB   (0.25 × 8 GiB; the declared 16 GiB is never applied)
  4 GiB effective host  ->  1073741824 = 1.00 GiB
  ```
  Also proved on a REAL cgroup (`full-suite-runner-cgroup.test.mjs`): inside a real `systemd-run --scope -p MemoryMax=4G`, the default resolves to 1 GiB, not 16 GiB.

- [x] AC3: the derivation's concurrency input is the measured actual concurrency (pasted: the value the code reads for a real round, equal to the per-file interval max for that round). With this host's data the diagnostic is ~12 GiB (< 16). A unit test proves the diagnostic can never raise the effective MemoryMax above the declared value.

  ```
  resolveSuiteMemoryMax(.quay) on this host:
    actualConcurrency        = 64           <- measured: max overlapping per-file intervals
    perFileHighWaterBytes    = 165314560    (p95 of perFile[].memPeakKb, pooled over the last 5 rounds)
    headroom                 = 1.25
    laneScaledEstimateBytes  = 13225164800  = 12.32 GiB   (< 16 GiB declared)
    effectiveMemoryMax       = 17179869184  = 16.00 GiB   bound=declared   <- NOT moved by the diagnostic
    independent brute-force overlap over the same 5 rounds: 64   (reader says 64)
    requested laneCount for those rounds (from the carrier): 126, 128, 127, 127, 128
    estimator at the measured 64 lanes                                          = 12.32 GiB  <  16 GiB
    estimator at the requested 128 lanes (what the first draft would have used) = 24.63 GiB
  ```
  ⇒ the concurrency input is the **measured 64**, not `nproc` 128; and at 64 the estimate (12.32 GiB) is **below** the declared baseline, so the baseline covers the measured shape of the suite. Mechanism for why 64 < 128: `suite-scheduler.ts`'s reliability cap keeps TOTAL concurrency at the lowest ACTIVE group's budget, and serial/lowconc budget = `defaultPhaseConcurrency` = floor(128/(S×P)) = 64.

  The no-raise property is pinned mechanically: `plugin/test/full-suite-runner-cgroup.test.mjs` "AC3/DoD — the diagnostic can NEVER raise the effective MemoryMax above the declared value" feeds the runner a ~1 TB / 200-way-concurrency measurement and asserts the effective ceiling is still 17179869184 with `bound=declared`; a second case (128-way measured concurrency) asserts the same.

- [x] AC4: `scripts/test.sh --for-task <this task>` green.

  ```
  bash scripts/test.sh --for-task gap-suite-memorymax-literal-16g-cap-pinned-every-round-while-lanes-scale-with-nproc --allow-thin
    warning: test-selection-thin: resolved tests for 2/6 Touches entries (0.33) < 0.5; pass --allow-thin to run anyway
    ℹ tests 172 / suites 0 / pass 172 / fail 0 / cancelled 0 / skipped 0
    EXIT=0
  ```
  Run on the FINAL tree (the single commit on `develop`; `git diff --name-only develop...HEAD` = the 7 code/test files): **172/172 green, exit 0**.

  **Scoped vs full, reported separately (DoD):** this is a **SCOPED** run — 172 tests from the change-relevant selection. ⛔ It is NOT a full-suite result and is not cited as one. This task runs **no** full suite (see the Re-scope): the runtime "≥3 complete, OOM-free rounds under the declared 16 GiB" proof belongs to `gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison`.

  - ⚠️ **Landing hazard for the FAN-IN suite step — unrelated to this delta; do not read its verdict as a full-suite result (flagged by the coordinator 2026-10-14):** since `e18ec4b04` (quality loop honours stop mid-round, 07:56Z) `plugin/test/quality-gate-driver-loop-watchdog.test.mjs` hangs. Every full suite since either recorded green on **65 of 579 files** (rounds 2660, 2661) or was killed by the silence watchdog at ≈19 min and then washed green by `rerun`. This task's scoped gate does not select that file (172/172 above), but the fan-in's own suite step will probably hit it — a 65-file or rerun-green landing must **not** be presented as a full-suite result.

## Definition of Done
- AC1-AC4 checked. **No commit on this branch raises the effective default above 16 GiB**; evidence, in the two halves the DoD asks for:
  - **grep of the resolved default** — the branch is a SINGLE commit on `develop` (`git rev-list develop..HEAD` prints exactly one sha; the draft commits that had raised the ceiling were squashed away, so no surviving commit raises it — and the squashed-away ones are preserved, see the history note below):
    ```
    $ git show HEAD:plugin/scripts/full-suite-runner.ts | grep 'SUITE_MEMORY_MAX_DEFAULT ='
    export const SUITE_MEMORY_MAX_DEFAULT = "16G";
    $ node --experimental-strip-types -e 'import("./plugin/scripts/full-suite-runner.ts").then(m=>console.log(m.defaultSuiteMemoryMax()))'
    17179869184        # = 16.00 GiB;  <= 16 GiB: true
    ```
    (No commit sha is quoted here on purpose: each re-squash rewrites the tip, while the tree this evidence was taken from is fixed by `git diff --name-only develop...HEAD` = the 7 files in Touches.)
  - **a test pinning it** — `plugin/test/full-suite-runner-cgroup.test.mjs`: *"DoD — no commit may raise the effective default above 16 GiB: the resolved default is PINNED here"* (asserts `SUITE_MEMORY_MAX_DEFAULT === "16G"`, `defaultSuiteMemoryMax() ≤ 16 GiB`, and `=== 16 GiB` on a host whose guardrail admits it).
  - **history note (2026-10-14, coordinator):** the pre-re-scope draft commits this branch carried (`42433a92c` … `7407c3e88` — the ones that DID raise the ceiling) were squashed into the single landed commit so the "no commit raises the default" property holds over the whole branch. They are preserved, not deleted:
    `refs/backup/gap-suite-memorymax-literal-16g-cap-pinned-every-round-while-lanes-scale-with-nproc/pre-squash-7407c3e88`.
- Scoped vs full counts reported separately (above): scoped = 172 tests / 0 fail; full = not run by this task.

## Touches
- tasks/gap-suite-memorymax-literal-16g-cap-pinned-every-round-while-lanes-scale-with-nproc.md
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/full-suite-runner-types.ts
- plugin/scripts/suite-params.ts
- packages/quay/src/systemd-scope.ts
- plugin/scripts/effective-capacity-probe.ts
- plugin/test/full-suite-runner-cgroup.test.mjs
- plugin/test/suite-params.test.mjs
