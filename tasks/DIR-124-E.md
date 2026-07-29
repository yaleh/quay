---
id: DIR-124-E
title: Schedule milestone stages across candidates with explicit resource
  semaphores and measured backpressure
status: todo
labels:
  - directive
  - human-steered
parent: DIR-124
children: []
extra:
  dirStatus: applied
  schema: v1
---

**type:** execution

## Proposal

Use [[DIR-123]] worktrees, [[DIR-124-B]] receipts, [[DIR-124-C]] stage adapters, and
[[DIR-124-D]] resource profiles to schedule stages—not whole milestone workflows—across selected
candidates. Allow Verify, Build, Audit, and Gate work from different milestones to overlap while
bounded semaphores prevent full-suite, port, CPU, memory, agent, package-build, and integration
contention.

This child is the first resource-aware pipeline release. Preserve one fenced integration writer and
a conservative serial fan-in/Land policy initially. Use real measurements to decide whether a
separate rolling Ready-to-Land/effect-lease child is worth its additional recovery complexity.

## Plan

N/A — depends on DIR-124-D and all earlier DIR-124 prerequisites. Roll out opt-in, replay the legacy
serial path, then prove real cross-stage overlap before considering a default switch.

## Finding

Current concurrency is milestone-wide and barrier-bound. A fast candidate cannot reuse idle agents
or proceed independently while another candidate spends tens of minutes in Build/full-suite work.
At the same time, unbounded concurrency has already produced repeated full-suite runs, resource
contention, and timeout risk.

After the earlier DIR-124 children, stages have the identities, effects, receipts, and resource
claims needed for a scheduler to distinguish safe overlap from destructive contention. The first
pipeline should exploit that information without immediately adding durable distributed leases or
crash-sensitive rolling Land.

## Requested action

1. Implement a central stage scheduler over the kernel transition graph, with observable candidate
   and resource queues.
2. Admit independent stages from different milestones concurrently when dependencies, worktree
   isolation, policy, halt/generation barriers, and resource capacity allow.
3. Implement bounded semaphores for agent slots, CPU, memory, full-suite execution,
   browser/integration ports, package builds, and the singleton integration writer.
4. Request resource sets atomically in canonical order; on timeout, release claims and retry with
   measured bounded backoff rather than holding partial resources.
5. Preserve one fenced Reconcile/Land application owner and deterministic serial fan-in in this
   first release.
6. Emit queued/running/waiting/completed events with wait reason, resource claims, utilization,
   execution time, and queue time.
7. Prove overlap on real disjoint milestones: at minimum Verify↔Build and Audit↔Build across
   candidates, plus a resource-saturated run showing full suites remain bounded.
8. Implement halt semantics: no new stage admission or Land transaction after halt; in-flight
   workers stop at a bounded recoverable receipt boundary.
9. Compare serial baseline versus pipeline throughput, critical path, utilization, full-suite
   count, timeout rate, and Land idle/wait time.
10. At close-out, record an explicit decision:
    - create a later DIR-124-F for rolling Ready-to-Land, effect leases, fencing-token durability,
      and Land crash recovery; or
    - reject/defer it because measured fan-in wait is not material.
11. Within dependency-safe candidates, use the measured descriptive priority
    `p_block / (execution cost + false-positive cost)` to order eligible checks/stages. This is an
    ordering hint only: required invariants, lifecycle barriers, and independent review remain
    non-skippable.
12. Calibrate any adaptive order/capacity change from at least three real post-change terminal
    shapes. Report verified-capability coverage, agent-minutes, tokens, finding recurrence,
    resource wait, and process-artifact output alongside wall-time throughput; do not count reduced
    acceptance coverage as efficiency.

## Acceptance Criteria

- [ ] A production scheduler dispatches kernel stages across multiple candidates; concurrency is not
  simulated by relabeling whole serial workflows.
- [ ] Real timestamps show Verify of one candidate overlapping Build of another and read-only Audit
  overlapping an independent Build.
- [ ] Full-suite, port, package-build, CPU/memory, agent, and integration-writer limits are enforced
  mechanically with observable wait reasons.
- [ ] A saturation negative control never exceeds configured full-suite/port/integration capacity
  and does not reproduce contention-induced timeout failure.
- [ ] Resource acquisition is deadlock-safe: no partial claim is held while waiting indefinitely
  for a later claim.
- [ ] Halt blocks new admission/Land and leaves in-flight work resumable from valid receipts.
- [ ] Legacy serial execution remains available and golden-replay compatible during opt-in rollout.
- [ ] Reconcile/Land remains a single fenced, deterministic shared-state writer.
- [ ] A real serial-versus-pipeline report quantifies throughput, critical path, queue/resource wait,
  utilization, test count, timeout rate, and Land wait.
- [ ] Cost-aware ordering is reproducible from receipt/telemetry inputs and changes only order among
  dependency-safe eligible work; a required invariant with zero recent findings still runs.
- [ ] Adaptive scheduling/capacity changes cite at least three real terminal shapes and report
  agent-minutes, tokens, finding recurrence, verified-capability coverage, and process-artifact
  output in addition to wall time.
- [ ] A control that reduces or removes independent Audit coverage is rejected as an efficiency
  improvement even if its wall time is lower.
- [ ] The task records an evidence-backed create-or-defer decision for DIR-124-F; it does not silently
  assume fine-grained effect leases or rolling Land are necessary.

## Definition of Done

Standard exp5 DoD clauses apply.

- [ ] At least two real, disjoint milestones traverse the installed stage scheduler with genuine
  cross-stage overlap and correct final Land results.
- [ ] Resource saturation, worker interruption, halt, and failed-stage negative controls preserve
  receipts and shared-state integrity.
- [ ] Independent audit verifies timestamps/resource counters against actual processes and commands,
  not scheduler log assertions alone.
- [ ] The measured wall-time result and DIR-124-F decision are recorded durably.

## Human verification when exp5 marks this DIR done

1. Did stages from different real milestones overlap, or only their labels?
2. Can full suites or scarce ports exceed their configured capacity?
3. Does a waiting stage explain which resource or dependency blocks it?
4. Is Land still the only integration writer?
5. Do measurements justify—or reject—the complexity of rolling Land/effect leases?

## Touches

- `experiments/quay-perpetual-stream/scripts/*stage-scheduler*`
- `experiments/quay-perpetual-stream/scripts/*resource-semaphore*`
- `experiments/quay-perpetual-stream/scripts/*workflow-kernel*`
- `experiments/quay-perpetual-stream/test/*stage-scheduler*`
- `experiments/quay-perpetual-stream/test/*resource-semaphore*`
- `plugin/scripts/*stage-scheduler*`
- `plugin/scripts/*resource-semaphore*`
- `plugin/scripts/*workflow-kernel*`
- `plugin/test/*stage-scheduler*`
- `plugin/test/*resource-semaphore*`
- `experiments/quay-perpetual-stream/OUTER-LOOP.md`
