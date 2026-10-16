---
id: gap-official-dist-delivery-acceptance-resource-optimization-quay-ccui-clean-host
title: 资源优化能力的正式 dist
  交付验收：Quay、ClaudeCodeUI、独立干净单项目宿主三方验证（完整性负例/OOM/超时/恢复/无残留、同commit同scope前后对比）
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
depends_on:
  - gap-quality-gate-driver-loop-watchdog-test-hangs-since-e18ec4b04
  - gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison
  - gap-resumable-long-experiments-via-driver-adopt-restart-not-separate-scheduler
  - gap-quality-continuous-resource-diagnostic-routine-mechanical-filter-then-semantic
  - gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls
---
## Proposal
**Final integration gate for the whole "check resource optimization" initiative, requested 2026-10-14: the official shipped dist artifact (not source-tree self-tests) must be verified on Quay's own host, on ClaudeCodeUI, and on an independent clean single-project host at a different path — covering completeness negative cases, OOM, timeouts, interrupt/resume, no leftover processes, and a same-commit same-full-scope before/after resource and failure-rate comparison.**

This repeats the pattern already used successfully this session for the architecture-analysis capability (`gap-quay-architecture-analysis-shipped-capability-cleanroom-acceptance`, done) and for the driver-restart E2E (`gap-driver-restart-anytime-busy-e2e-on-dist-kernel`, done): build the real `publish-dist-branch.sh` artifact, verify on a `.git`-free clean-room host with no quay source checkout, then on the real hosts.

Gated on all of P0 and A-E landing first (there is nothing to package-test before the underlying fixes exist), per the stated sequencing: P0+A/B basics, then C, then E and F.

## Plan
1. Build the official dist artifact from develop once all dependencies have landed.
2. Clean-room host (independent single-project path, no quay source checkout, `.quay/plugin` resolved to the artifact — same isolation discipline as the earlier cleanroom task): run the full completeness/telemetry/lifecycle/host-adapter stack's negative cases — a planted OOM, a planted timeout, an interrupted-and-resumed experiment, a killed suite — and confirm no leftover process and no false-green.
3. Quay's own host and ClaudeCodeUI: deploy via the established live anchor-takeover handoff (no service interruption), verify the same capability set runs for real, and run the same-commit same-full-scope before/after comparison (resource usage, wall time, failure rate) that `gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison` already produced in its own task — cited here, not re-run from scratch.
4. No budget ceiling is raised on any host as part of this acceptance.

## Acceptance Criteria
- [ ] AC1: clean-room host, official dist, no quay source checkout: a planted OOM and a planted timeout each produce the correct non-green verdict with no leftover process (pasted, both cases, negative controls included).
- [ ] AC2: clean-room host: an interrupted experiment (driver restart mid-run) resumes correctly per the C task's manifest, without recomputing a completed stage (pasted).
- [ ] AC3: Quay's own host, live anchor, official dist: a real round of the completeness/telemetry/diagnostic-routine stack, cited same-commit same-scope before/after numbers from the heavy-files/concurrency task (pasted).
- [ ] AC4: ClaudeCodeUI, live anchor, official dist: the same real round and verification, via the established takeover handoff with no interruption to its own in-flight work (pasted).
- [ ] AC5: `scripts/test.sh --for-task <this task>` green on the source tree in addition to the three host checks above.

## Definition of Done
- AC1-AC5 checked with pasted evidence from all three hosts. No budget ceiling raised anywhere. No global user-scope plugin install modified.

## Touches
- tasks/gap-official-dist-delivery-acceptance-resource-optimization-quay-ccui-clean-host.md
- plugin/scripts/publish-dist-branch.sh
