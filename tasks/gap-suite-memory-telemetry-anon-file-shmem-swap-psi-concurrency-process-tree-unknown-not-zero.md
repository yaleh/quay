---
id: gap-suite-memory-telemetry-anon-file-shmem-swap-psi-concurrency-process-tree-unknown-not-zero
title: 套件内存遥测补齐：memory.stat anon/file/shmem、swap、events、PSI、实际 phase
  并发、子进程树；采不到记 unknown 不记 0
status: done
labels:
  - gap
parent: null
children: []
extra: {}
depends_on:
  - gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls
---
## Proposal
**Read-only diagnosis 2026-10-14 (coordinator): the evidence needed to choose a suite memory policy was never collected.** What the runner records today (`full-suite-runner.ts` `readCgroupMemoryEvents` / `writeSuiteMemoryEvidence`, `:1276-1381`): `peakBytes`, `memoryMaxBytes`, `oom`, `oomKill`, `phase`, a sample **count**. `suite-load-*.jsonl` adds only `loadavg`, `cpu_stall`, `mem_avail`. Consequences measured in that diagnosis:
- **The anon / file-cache / shmem split at peak or at the moment of an OOM kill is unknown.** A `peakBytes` sitting at `MemoryMax` (47/136 runs, 10-10→10-14) is shaped the same whether page cache filled the scope (harmless) or anonymous memory did (pressure). The kernel log that would say which is unreadable to this user (`journalctl -k` / `dmesg`: not in adm/systemd-journal).
- **Child-process memory is invisible.** Per-file `memPeakKb` is `RUSAGE_SELF` (`per-file-cpu-report.mjs:31-42`). 543/961 test files spawn/exec/fork. In rounds 2654-2659 the sum of concurrent per-file peaks was 10.9-13.4 GiB while the scope peak read 16.0 GiB.
- **Actual concurrency is not recorded.** Rounds record `laneCount` 127-128 (= nproc). Per-file start/end intervals show **max 64** files concurrently (`defaultPhaseConcurrency` = floor(nproc/(S×P)) = 64, `full-suite-runner.ts:774-775`).
- **Swap is unobserved.** The host swap file is 32 GiB with 28.7 GiB used on a shared host. The suite scope sets no `MemorySwapMax`, and the leaked suite scope `run-u286396` peaked at 2.96 GiB swap.

## Plan
Low-overhead, portable sampling inside the suite scope (same sampler that already reads `memory.events`), at the existing sample cadence:
1. `memory.stat`: `anon`, `file`, `shmem`, `file_mapped`, `sock`. Keep max-of-each, plus the snapshot **at the sample of peak `memory.current`**, plus the snapshot at the first sample where `oom_kill` rose.
2. `memory.swap.current` (max) and `memory.swap.peak` if present. `memory.events` `high`, `max`, `oom`, `oom_kill` (deltas over the round). `memory.pressure` `some/full avg10` max and `total` delta.
3. Actual concurrency: max concurrent planned files per phase (from the runner's own scheduler state, not inferred from nproc), recorded next to `laneCount`, with a note of what `laneCount` means.
4. Process-tree accounting: at each sample, the count and summed RSS of **all** processes in the scope (cgroup.procs), split into planned test-file processes vs their descendants. Recorded as max and at-peak.
5. **Portability and honesty.** Every field is read independently. A field whose source is absent or unreadable (no cgroup v2, not a systemd scope, different kernel, no `memory.swap.*`, no PSI) is recorded as `null` with a `<field>_unavailable: <reason>`. It is **never 0**. No hardcoded cgroup path: resolve from the scope unit / `/proc/self/cgroup` the runner already uses. No dependency on another project or service. Overhead budget: ≤1% of suite wall (measured, pasted).

## Acceptance Criteria
- [x] AC1: a real suite run (the next naturally scheduled fan-in suite, **not** a manually launched extra full run) records all fields above (pasted evidence JSON). anon/file/shmem at peak sum to within tolerance of `memory.current` at that sample (pasted arithmetic).
- [x] AC2: fixture: a scope whose `memory.stat` / `memory.swap.current` / `memory.pressure` are absent or unreadable records `null` + reason for exactly those fields, while the readable fields are still filled (pasted, plus pre-fix negative control showing today's file records no such fields).
- [x] AC3: actual max concurrency per phase is recorded and equals the value recomputed from per-file intervals on the same round (pasted both numbers).
- [x] AC4: sampler overhead measured on a fixture suite: wall-clock delta ≤1% (pasted).
- [x] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence. No new full-suite runs launched solely for this task (AC1 rides a natural fan-in). No MemoryMax change in this task.

## Touches
- tasks/gap-suite-memory-telemetry-anon-file-shmem-swap-psi-concurrency-process-tree-unknown-not-zero.md
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/full-suite-runner-types.ts
- plugin/scripts/host-resource-adapter.ts
- plugin/test/full-suite-runner-cgroup.test.mjs
- plugin/test/full-suite-runner-oom-policy.test.mjs
- plugin/test/host-resource-adapter.test.mjs
