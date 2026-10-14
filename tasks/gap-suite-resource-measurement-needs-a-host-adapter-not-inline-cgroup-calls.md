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
6. Touches widened during implementation, declared through the task ABI (not hand-edited): `plugin/scripts/full-suite-runner-types.ts` (the `SuiteMemoryEvidence` readings become THREE-VALUED — `oom`/`oomKill` are `null` when the adapter never produced a reading, instead of the fabricated `0` that AC2 targets), `plugin/scripts/worker-driver.ts` (the READER of that carrier fabricated the same `0` for a missing `oom` — the sibling instance of the same defect, 硬规则 5b), `plugin/scripts/capability-catalog-declarations.json` (a new `plugin/scripts/*` file must be declared or the catalog exits non-zero), and `plugin/test/full-suite-runner-oom-policy.test.mjs` (it pins the old `oomKill: 0`-when-unreadable reading and the old evidence key set).

## Acceptance Criteria
- [x] AC1: the Linux adapter's readings are byte-for-byte equivalent to the current inline logic on a real round on this host (pasted comparison, both arms).
- [x] AC2: a fixture "unsupported host" adapter (no cgroup) returns `null`+`reason` for every reading, and the runner/telemetry task's fields read `unknown` (not `0`) through it — proving the chain, not just the adapter in isolation (pasted).
- [x] AC3: no file in this change contains a literal absolute path naming another project, and no runtime call requires another project's process/service to exist (grep-verifiable, pasted).
- [x] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked with pasted evidence. The already-landed declared `memory_max` value and its resolution logic are unchanged in behavior.

## Evidence

**AC1 — byte-for-byte equivalence, both arms, on a REAL scope on this host.**
Arm BEFORE = the implementation extracted VERBATIM from the parent commit `d3110c0fd`
(`git show d3110c0fd:plugin/scripts/full-suite-runner.ts`); arm AFTER = the worktree's adapter. Both
read the SAME real `systemd-run --user --scope -p MemoryMax=512M` scope
(`/sys/fs/cgroup/user.slice/user-1004.slice/user@1004.service/app.slice/run-*.scope`) holding a live
memory-touching child:
- `readCgroupMemoryPeak(dir)`: before `10903552` / after-adapter `10903552` / after-runner-helper `10903552` ⇒ equal.
- `readCgroupMemoryEvents(dir)`: before `{"oom":0,"oomKill":0}` / after-runner-helper `{"oom":0,"oomKill":0}` ⇒ byte-identical; the adapter additionally exposes `max:0` (an ADD, not a change).
- unreadable dir: before `null`/`null`, after `null`/`null` ⇒ equal.
- `buildSystemdRunArgv(command, limits)` for THIS workspace's real resolved limits
  (`resolveSuiteMemoryMax('.quay')` ⇒ `memoryMax=17179869184`, `bound=declared`, `declared=16G`,
  `declaredSource=default`), for the bare template and for an all-dimensions case: argv equal in all
  three (`["systemd-run","--user","--scope","--quiet","-p","MemoryAccounting=yes","-p","OOMPolicy=continue","-p","MemoryMax=…","bash","-c",…]`).

**AC2 — null+reason for every reading on a blind host, and `unknown` (⛔ not `0`) through the runner.**
Chain driven through the REAL `full-suite-runner.ts` on a fake suite, twice, differing only in
`QUAY_TEST_HOST_RESOURCE_ADAPTER`:
- arm A (host adapter): `"oom": 0, "oomKill": 0, "peakBytes": 823296, "samples": 1, "adapter": {"kind":"linux-cgroup-v2","available":true,"reason":null}` — a MEASURED zero.
- arm B (`unsupported`): `"oom": null, "oomKill": null, "peakBytes": null, "samples": 0, "adapter": {"kind":"unsupported-host","available":false,"reason":"no scope for pid …: QUAY_TEST_HOST_RESOURCE_ADAPTER=unsupported — forced by the test/ops seam"}` — UNKNOWN, with the reason on the record.
- The adapter itself, EVERY reading method (`available` / `scopeOf` / `readMemory` / `readMemoryEvents` / `readProcessTree`) returns `{value:null, reason:"<non-empty>"}`; `plugin/test/host-resource-adapter.test.mjs` (11 tests) enumerates the method set and pins both implementations.
- Carrier contract change: `SuiteMemoryEvidence.oom` / `oomKill` are `number|null`, and the reader in `worker-driver.ts` no longer fabricates `0` for a missing `oom` — so `0` now means 「read a zero」 and `null` means 「not read」. An un-enveloped / unmeasurable round now LANDS the evidence file (all-unknown) instead of landing no file at all, because 「no file」 is indistinguishable from 「the runner died before teardown」.

**AC3 — no other project's path, no other project's process/service.**
Over the ADDED lines only (`git diff develop -- <the 8 changed files> | grep '^+'`):
- the only absolute-path literal added is `"/sys/fs/cgroup"` (a kernel interface, declared ONCE in `packages/quay/src/systemd-scope.ts`); every other regex hit is prose or a repo-relative import.
- ZERO added lines name a foreign project (`grep -niE 'claudecodeui|cantus|cloudcli'` over the added lines).
- every runtime call added targets this host only: `fs.existsSync(LINUX_CGROUP_V2_ROOT)`, `fs.readFileSync(path.join(scopeDir, file))` (scopeDir derived from `/proc/<pid>/cgroup`), and `spawn(argv[0], …)` where argv is the local supervisor's argv. No socket, no daemon, no second workspace, no shared resource centre.
- ⚠️ honesty note: the PRE-EXISTING declaration for `discovery-closed-loop-report.ts` inside `capability-catalog-declarations.json` (a file this change appends exactly 5 lines to) does carry `/data/home/yale/work/claudecodeui` as a documented CLI example. It is untouched by this change and is another tool's usage prose — not a path this change reads, requires, or could make a runtime call to.

**AC4 — the scoped gate.** `bash scripts/test.sh --for-task gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls --allow-thin` ⇒ `exit=0`, `ℹ tests 253 / pass 253 / fail 0`. Supporting gates: `npx tsc --noEmit -p packages/quay` (the declared `ts-typecheck` command) ⇒ exit 0; `anti-drift-touches-check` ⇒ `ANTI-DRIFT OK … 8 actual file(s), all within declared Touches`; `capability-catalog.sh` ⇒ `382 scripts | 382 declared | 0 unclassified | 377 ship` (shipped-set count unchanged — the new file added no bundle entry).

**DoD — the declared policy is unchanged.** `declaredSuiteMemoryMax` / `suiteMemoryMax` / `resolveSuiteMemoryMax` / `SUITE_MEMORY_MAX_DEFAULT` do not appear anywhere in the diff, and the real round's resolved policy above still reads `16G / declared / default` — the same value, the same provenance, the same binding rule as before this change.

**Boundary of this change (⛔ not claimed).** The per-phase CPU/PSI differential accounting keeps its own shared module (`plugin/scripts/suite-accounting.ts`), which this change neither moves nor wraps. The adapter owns the memory/swap/OOM/memory-PSI/process-tree readings and the bounded launch; `suite-accounting.ts` remains the ONE implementation of the cgroup v2 DIRECTORY resolution, and the adapter calls it rather than keeping a second copy.

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
