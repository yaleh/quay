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

## Acceptance Criteria
- [ ] AC1: the Linux adapter's readings are byte-for-byte equivalent to the current inline logic on a real round on this host (pasted comparison, both arms).
- [ ] AC2: a fixture "unsupported host" adapter (no cgroup) returns `null`+`reason` for every reading, and the runner/telemetry task's fields read `unknown` (not `0`) through it — proving the chain, not just the adapter in isolation (pasted).
- [ ] AC3: no file in this change contains a literal absolute path naming another project, and no runtime call requires another project's process/service to exist (grep-verifiable, pasted).
- [ ] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked with pasted evidence. The already-landed declared `memory_max` value and its resolution logic are unchanged in behavior.

## Touches
- tasks/gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls.md
- plugin/scripts/host-resource-adapter.ts
- plugin/scripts/full-suite-runner.ts
- packages/quay/src/systemd-scope.ts
- plugin/test/host-resource-adapter.test.mjs
