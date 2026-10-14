---
id: gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls
title: 套件资源测量/执行改走宿主 adapter 接口：Linux cgroup/systemd 只是一个实现，不硬编码跨项目路径、不建资源中心
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
## Proposal
**Capability requested 2026-10-14: resource measurement and enforcement must go through a host adapter, with Linux cgroup v2/systemd-run as ONE adapter implementation, not the only possible one — and the policy (budget/concurrency) must be a driver-declared configuration layer, independent of the gate that enforces completeness.**

Current state, confirmed by reading the code this session: `full-suite-runner.ts` calls `readCgroupMemoryEvents`, `memory.stat`, `memory.events` paths and `systemd-run` argv construction directly inline. The newly-landed `gap-suite-memorymax-literal-16g-cap-pinned-every-round-while-lanes-scale-with-nproc` made the VALUE declarable (`.quay/config.yml` `suite.memory_max`) but the MECHANISM reading/enforcing it is still Linux-cgroup-specific code inside the runner, with no seam for a different host or a different project's own resource surface.

This task does not change the declared-value work already landed; it extracts the measurement/enforcement mechanism behind an interface, so: (a) the already-filed telemetry task's new fields (anon/file/shmem/swap/PSI/process-tree) can be read through one adapter contract rather than scattered inline cgroup-path reads; (b) a different host (no cgroup v2, or a non-systemd supervisor) can implement the same contract without touching the runner; (c) nothing hardcodes a project path or assumes another project's resource service exists.

## Plan
1. Define a narrow adapter interface: given a scope handle, return (or `null`+`reason` when unavailable) memory current/peak/stat-breakdown, swap, OOM/pressure events, process tree. A second method starts a bounded-resource child process and returns its scope handle. No method assumes Linux cgroup specifics in its signature.
2. Implement the Linux cgroup v2 + systemd-run adapter as the first (and for now only) implementation, moving the existing inline logic behind it without changing its readings (regression: identical output on this host, before/after).
3. The runner, the telemetry task's fields, and the memorymax declared-policy resolution all go through this one adapter, not three separate inline readers.
4. **No cross-project resource center.** The adapter is per-process-tree (the suite's own scope), not a shared daemon; nothing in this task requires Quay and ClaudeCodeUI (or any other project) to coordinate through a shared service. Each project's own driver declares its own policy independently.
5. Policy (declared memory/concurrency values) and the completeness/OOM gate (`gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files`) stay separate modules: the gate reads adapter output and a declared policy value, but does not own either.
6. Touches widened during implementation, declared through the task ABI (not hand-edited): `plugin/scripts/full-suite-runner-types.ts` (the `SuiteMemoryEvidence` the READER parses becomes THREE-VALUED — `oom`/`oomKill` are `null` when the carrier holds no number, instead of the fabricated `0` that AC2 targets), `plugin/scripts/worker-driver.ts` (the READER of that carrier fabricated the same `0` for a missing `oom` — the sibling instance of the same defect, 硬规则 5b), `plugin/scripts/capability-catalog-declarations.json` (a new `plugin/scripts/*` file must be declared or the catalog exits non-zero), and `plugin/test/full-suite-runner-oom-policy.test.mjs` (it pins the old `oomKill: 0`-when-unreadable reading and the old evidence key set).
   ⚠️ **MERGE NOTE (2026-10-15, recorded rather than papered over):** while this branch was in flight, `gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files` landed on develop and fixed the SAME 硬规则 3b defect on the WRITE side, choosing a NAMED `"unknown"` (not `null`) for the carrier's `peakBytes`/`oom`/`oomKill`, plus a `telemetry: "ok"|"unknown"` dimension. The merge KEEPS develop's landed carrier representation (it has consumers inside `full-suite-runner.ts` and pins in this same test file, and it is what AC2's wording — 「read `unknown`, not `0`」 — literally asks for) and KEEPS this task's `number|null` reader-side type + `worker-driver.ts` fix. The sampler is now adapter-driven and feeds develop's `eventsRead`/`peakRead` booleans from the adapter's readings, so the two independent fixes compose instead of one silently reverting the other.

## Acceptance Criteria
- [x] AC1: the Linux adapter's readings are byte-for-byte equivalent to the current inline logic on a real round on this host (pasted comparison, both arms).
- [x] AC2: a fixture "unsupported host" adapter (no cgroup) returns `null`+`reason` for every reading, and the runner/telemetry task's fields read `unknown` (not `0`) through it — proving the chain, not just the adapter in isolation (pasted).
- [x] AC3: no file in this change contains a literal absolute path naming another project, and no runtime call requires another project's process/service to exist (grep-verifiable, pasted).
- [x] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked with pasted evidence. The already-landed declared `memory_max` value and its resolution logic are unchanged in behavior.

## Evidence

**AC1 — byte-for-byte equivalence, both arms, on a REAL scope on this host (re-run 2026-10-15 on the MERGED tree).**
Arm BEFORE = develop's inline logic, copied VERBATIM out of `git show develop:plugin/scripts/full-suite-runner.ts`
(the pre-seam implementation, including its `buildSystemdRunArgv` argv construction); arm AFTER = the worktree's
adapter-backed helpers (`readCgroupMemoryEvents` / `readCgroupMemoryPeak` / `buildSystemdRunArgv`). Both arms read
the SAME real scope that this session's own anchor lives in
(`/sys/fs/cgroup/user.slice/user-1004.slice/user@1004.service/app.slice/quay-anchor-quay-1791985268368.scope`):
- `readCgroupMemoryEvents(dir)`: before `{"oom":0,"oomKill":0}` / after `{"oom":0,"oomKill":0}` ⇒ byte-identical.
- `readCgroupMemoryPeak(dir)`: before `27917291520` / after `27917291520` ⇒ equal.
- unreadable dir (`/nope/nope`): before `null`/`null`, after `null`/`null` ⇒ equal.
- `buildSystemdRunArgv("bash scripts/test.sh", limits)` byte-identical (`=== true`) in all three cases —
  the workspace's real resolved limits (`memoryMax=17179869184`), an all-dimensions case
  (`MemoryMax=300M CPUQuota=200% TasksMax=64 MemorySwapMax=0`), and the bare template:
  `["systemd-run","--user","--scope","--quiet","-p","MemoryAccounting=yes","-p","OOMPolicy=continue","-p","MemoryMax=17179869184","bash","-c","bash scripts/test.sh"]`.
  (Corroborated by `plugin/test/host-resource-adapter.test.mjs` — "ONE builder — the adapter's launchArgv is byte-identical to the runner's buildSystemdRunArgv".)

**AC2 — `{value:null, reason}` for every reading on a blind host, and `unknown` (⛔ not `0`) through the runner.**
Chain driven through the REAL `full-suite-runner.ts` on a fake suite, twice, differing ONLY in
`QUAY_TEST_HOST_RESOURCE_ADAPTER` (`QUAY_TEST_SYSTEMD_RUN_AVAILABLE=1`, `QUAY_TEST_SKIP_SYSTEMD_RUN=0` in both arms;
the landed evidence file was read back from `<root>/.quay/`):
- arm A (host adapter) ⇒ `"adapter": {"kind":"linux-cgroup-v2","available":true,"reason":null}`,
  `"oom": 0, "oomKill": 0, "telemetry": "ok", "samples": 1`, plus the adapter's full reading
  (`"memory": {"currentBytes":24576,"peakBytes":610304,"limitBytes":17179869184,"swapCurrentBytes":0,"stat":{…},"pressure":"some avg10=0.00 …"}`) and `"processTreePids": []` — a MEASURED zero.
- arm B (`unsupported`) ⇒ `"oom": "unknown", "oomKill": "unknown", "peakBytes": "unknown", "telemetry": "unknown", "samples": 0`,
  and the reason is ON the record rather than inferred:
  `"adapter": {"kind":"unsupported-host","available":false,"reason":"no scope for pid 414493: QUAY_TEST_HOST_RESOURCE_ADAPTER=unsupported — forced by the test/ops seam"}`.
  ⛔ No `0` anywhere in arm B: `0` is a measurement (「no OOM occurred」) and a host that never read is not entitled to make it (硬规则 3b/6).
  Note arm B still LANDS the evidence file — 「no file」 is indistinguishable from 「the runner died before teardown」, so the blind round writes an all-`unknown` record instead.
- The adapter itself, EVERY reading method (`available` / `scopeOf` / `readMemory` / `readMemoryEvents` / `readProcessTree`)
  returns `{value:null, reason:"<non-empty>"}`; `plugin/test/host-resource-adapter.test.mjs` (11 tests) enumerates the method set and pins both implementations.
- Carrier contract change (the READ side): `SuiteMemoryEvidence.oom` / `oomKill` are `number|null` and `worker-driver.ts`
  no longer fabricates `0` for a missing `oom` — `0` now means 「read a zero」, `null` means 「not read」. Together with the
  write side's named `"unknown"` (see the MERGE NOTE in the Plan) the whole chain is three-valued at both ends.

**AC3 — no other project's path, no other project's process/service.**
Over the ADDED lines only (`git diff develop...HEAD | grep '^+'`):
- ZERO added lines name a foreign project (`grep -niE 'claudecodeui|cantus|cloudcli'` over the added lines ⇒ no match).
- ZERO added lines carry an absolute-path literal under `/usr`, `/home`, `/opt`, `/var`, `/data`, `/srv` (⇒ no match).
- the only absolute-path literal added at all is `"/sys/fs/cgroup"` — a KERNEL interface, which names no project. It is
  declared once in this change (`packages/quay/src/systemd-scope.ts`'s `LINUX_CGROUP_V2_ROOT`) and used by
  `host-resource-adapter.ts` for its availability question and its named refusal reason.
- every runtime call added targets this host only: `fs.existsSync(LINUX_CGROUP_V2_ROOT)`, `fs.readFileSync(path.join(scopeDir, file))`
  (scopeDir derived from `/proc/<pid>/cgroup`), and `spawn(argv[0], …)` where argv is the LOCAL supervisor's argv or the plain
  `bash -c`. No socket, no daemon, no second workspace, no shared resource centre.
- ⚠️ honesty notes (both about content this change does NOT own): (i) the PRE-EXISTING declaration for
  `discovery-closed-loop-report.ts` inside `capability-catalog-declarations.json` (a file this change appends exactly 5 lines to)
  carries `/data/home/yale/work/claudecodeui` as a documented CLI example — untouched, another tool's usage prose, not a path
  this change reads or could call. (ii) the `/sys/fs/cgroup` literal also pre-exists in three plugin-side modules this change
  does not touch (`effective-capacity-probe.ts:109` `CGROUP_ROOT`, `driver-runtime.ts:1863`, `suite-accounting.ts:94`); folding
  those into the single declaration is a follow-on, not something this task silently claims to have done.

**AC4 — the scoped gate (re-run 2026-10-15 on the MERGED tree).**
`bash scripts/test.sh --for-task gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls --allow-thin`
⇒ `exit=0`, `ℹ tests 271 / pass 271 / fail 0`. Supporting gates: `npx tsc --noEmit -p packages/quay` ⇒ exit 0;
`anti-drift-touches-check` ⇒ `ANTI-DRIFT OK … 8 actual file(s), all within declared Touches`; `capability-catalog.sh`
⇒ `382 scripts | 382 declared | 0 unclassified | 377 ship` (shipped-set count unchanged — the new file added no bundle entry).
Delta-relevant suites re-run directly on the merged tree: `plugin/test/full-suite-runner-oom-policy.test.mjs` 23/23 pass,
`plugin/test/host-resource-adapter.test.mjs` 11/11 pass.

**DoD — the declared policy is unchanged.** `declaredSuiteMemoryMax` / `suiteMemoryMax` / `resolveSuiteMemoryMax` /
`SUITE_MEMORY_MAX_DEFAULT` do not appear anywhere in this change's diff, and the real round's resolved policy still reads
`16G / declared / default` (visible verbatim in the arm-A evidence above: `"memoryMaxPolicy": {"memoryMax":"17179869184","bound":"declared","declared":"16G","declaredSource":"default"}`)
— the same value, the same provenance, the same binding rule as before this change.

**Boundary of this change (⛔ not claimed).** The per-phase CPU/PSI differential accounting keeps its own shared module
(`plugin/scripts/suite-accounting.ts`), which this change neither moves nor wraps. The adapter owns the memory/swap/OOM/
memory-PSI/process-tree readings and the bounded launch; `suite-accounting.ts` remains the ONE implementation of the cgroup v2
DIRECTORY resolution, and the adapter calls it rather than keeping a second copy. `telemetryAttempted` deliberately keeps its
landed meaning (「this round was ENVELOPED and we tried to read」) even though the sampler now starts on every round — a
non-scope round still carries NO telemetry key on the state/round records (缺键 ≠ unknown), it merely lands an all-`unknown`
evidence FILE.

**Recurring exit-not-landed (2026-10-14/15) — root cause verified this session; ⛔ neither defect is in this change's diff.**
AC1-AC4 are green (readings above, re-measured 2026-10-15 on the merged tree:
`ℹ tests 271 / pass 271 / fail 0`, `tsc` exit 0, `ANTI-DRIFT OK … 8 actual file(s)`, `task_check` ⇒
`gate=execute->done ok=true acTotal=4 acChecked=4`), yet two consecutive fan-in rounds exited-not-landed at `step=suite`
with `SUITE-INCOMPLETE reason=oom-killed`. Both causes were read out of the artefacts rather than inferred, and both are
**deterministic** — so a third identical round will fail identically.

1. **The suite runs pinned against its own declared ceiling, below what its own estimator requires.**
   `suite-memory-evidence-mfi-…-1791997319044-50ef83.json`: `peakBytes 17180139520` vs `memoryMaxBytes 17179869184`
   (16 GiB) — the scope sat AT its cap for the whole round (`oom 15412`, `oomKill 2`, `phase "main"`, `samples 155`).
   The runner's OWN lane-scaled estimator, over the SAME record, says the lane count it actually ran needs more than the
   cap allows: `actualConcurrency 128`, `perFileHighWaterBytes 133136384` ⇒ `laneScaledEstimateBytes 21301821440`
   (≈19.8 GiB), while `laneScaledExceedsHostGuard false` against `hostGuardBytes 27917287424` (27.9 GB) — i.e. the HOST
   could afford it. The binding cap is `bound: "declared"`, `declared: "16G"`, `declaredSource: "default"` (no config
   declares it; it is the code default). **So the cap is below the estimator's requirement for the lane count in use
   while the host has headroom ⇒ an OOM at this lane count is predicted, not incidental.**
   ⛔ Not fixed here: this task's DoD pins the declared value and its resolution logic as unchanged, and
   `gap-suite-memorymax-literal-16g-cap-pinned-every-round-while-lanes-scale-with-nproc` — the task whose title names
   exactly this mismatch — is already `done`.

2. **The recovery ladder is STRUCTURALLY unreadable: it can never certify a rung, whatever the rung did.**
   `worker-fan-in.ts:879` `recoverySuiteCommand` appends ONLY `--lane-count <n>` to the ORIGINAL suite command. That
   command already carries `--log-file <suiteLogFile>` (`worker-fan-in.ts:1958`), and it is **not re-pointed** — so every
   recovery rung's runner keeps teeing into the ORIGINAL log file. Meanwhile `spawnSuiteAndWait` (`suite-driver.ts:204-206`)
   writes only the child's **stdout** into the `logFile` it is handed, and `worker-fan-in.ts:2930-2932` passes `recLogFile`
   there and nowhere else; the runner writes its diagnostics to **stderr** and never to stdout.
   ⇒ `recLogFile` is empty **by construction** ⇒ `classifyRecoveryRound` (`worker-fan-in.ts:833`) returns
   `no-conclusion(reason="log-unreadable")` for EVERY rung.
   **Measured (not inferred):** all three recovery logs are 0 bytes with mtime == their own start instant
   (`recovery-64-…-8c87d9.log` 0 B @ 17:09:01; `recovery-48-…-1cb154.log` 0 B @ 17:14:37; `recovery-32-…-955562.log`
   0 B @ 17:23:31) while those rungs ran 335 s / 533 s / 323 s (`fan-in-step-trace.jsonl`:
   `suite-recovery … "reason":"recovery round had no conclusion (log-unreadable)"` at concurrency 64, 48, 32) — the rungs
   demonstrably RAN. And the log named for the ORIGINAL attempt (`…1791997319049-f8682e.log`, 1.99 MB, mtime ==
   recovery-32's END 17:28:47) contains exactly **ONE** `SUITE-RUN-START`, `log=…1791997319049-f8682e.log`,
   `ts=2026-10-14T17:23:37Z` = recovery-32's start + 6 s — i.e. the rungs overwrote one another's output into the
   original file, while their own files stayed empty.
   **Consequence (硬规则 3b):** `suite-recovery-blocked` then reports
   `recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a
   code/config fix, see plugin/scripts/full-suite-runner.ts`. That message asserts a VERDICT was reached and found
   incomplete; no verdict was ever READ. 「降档后仍不完备」 and 「读不懂」 are flattened into one reading, and its trailing
   pointer names a file that is not where the defect lives (the defect is in `worker-fan-in.ts` / `suite-driver.ts`).
   ⛔ Not fixed here: both files are outside this task's declared `## Touches`, and Plan item 5 explicitly assigns the
   OOM/completeness gate to a separate module this task does not own. Recorded by this entry instead of silently
   widened into this task's diff.

## Touches
- tasks/gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls.md
- plugin/scripts/host-resource-adapter.ts
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/full-suite-runner-types.ts
- plugin/scripts/worker-driver.ts
- plugin/scripts/capability-catalog-declarations.json
- packages/quay/src/systemd-scope.ts
- plugin/test/host-resource-adapter.test.mjs
- plugin/test/full-suite-runner-oom-policy.test.mjs

## Blocker

**2026-10-14T17:29:57.975Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: oom-killed (1) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：57fbcbc8-f58b-4e57-8e0f-a6feef0ff1c9
