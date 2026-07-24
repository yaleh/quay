---
id: ADR-017
title: "Concurrent multi-milestone execution — multiple touches-disjoint, execution-type
  milestones may run concurrently via the DIR-044 batch scheduler; learning-type milestones
  are always serial"
status: accepted
date: 2026-07-24
accepted-date: 2026-07-24
supersedes: []
superseded-by: []
tags:
  - methodology
  - workflow
  - concurrency
---
## Context

ADR-009 established that development runs via background workflows at milestone granularity —
one workflow episode ≈ one milestone. It did not address whether multiple milestones could run
concurrently. DIR-044 (2026-07-18) built a complete concurrent-scheduler mechanism:
`concurrent-batch-scheduler.ts` (greedy touches-disjoint batch assembly),
`serial-fanin-absorb.ts` (deterministic merge plan + counter advance),
`touches-orthogonality-check.ts` (conservative fail-closed disjointness verdict), and
`anti-drift-touches-check.ts` (post-build NON-WAIVABLE guardrail on real diffs).
The mechanism was proven live once (M75 ∥ M76, DIR-044-LIVE) but was never wired into
exp5's own OUTER-LOOP.md. DIR-075 (2026-07-24) wires it in.

## Decision

**When two or more milestone candidates are touches-disjoint AND execution-type (not learning),
they MAY execute concurrently in a single batch.** The DIR-044 batch scheduler is the single
source for the assembly decision (ADR-004). The fan-in is always serial — concurrent builds,
serial merge — with an after-the-fact anti-drift HARD FAIL that aborts the batch on any
mis-declared overlap.

**Constraints (from DIR-044, never re-derived):**

1. **Learning-type always serial.** Any milestone whose charter `type:` matches `/learning/i`
   is deferred from batching — the SELECT←ABSORB learning dependency requires serial execution.
2. **Shared-state always serial.** Any milestone whose `## Touches` covers dashboard.md,
   backlog.md, v-meta-ledger.md, or gate-events.jsonl is deferred — concurrent writes to
   these files would collide.
3. **Touches-disjoint required.** Two milestones may batch ONLY IF `touches-orthogonality-check.ts`
   returns `disjoint: true` — conservative fail-closed (absent/empty/overbroad `## Touches`
   → serialize).
4. **Anti-drift HARD FAIL.** After all concurrent builds complete, `anti-drift-touches-check.ts`
   runs on the REAL diffs. Any out-of-declared write OR cross-build overlap → abort the ENTIRE
   batch, NON-WAIVABLE.
5. **Fan-in is serial.** `serial-fanin-absorb.ts` merges survivors one-at-a-time in deterministic
   (stable-sort by milestone id) order. `milestone_counter` advances by survivors.length, not N.
6. **Concurrency is opt-in.** Default is 1 (serial). `concurrency: N` in `.quay/loop.yml`
   sets max batch width. A 1-wide batch is a valid outcome, not an error.

## Consequences

- **Extends ADR-009:** the "one workflow episode ≈ one milestone" model now supports N concurrent
  episodes when the constraints above are satisfied.
- **Forbids:** concurrent execution of learning-type milestones; batching milestones without
  well-declared `## Touches`; trusting declared touches without the anti-drift guardrail.
- **Enables:** product/deliverable milestones touching disjoint `packages/` files to run in
  parallel while methodology/governance milestones run serial — the two classes naturally
  interleave under the scheduler.
- **Scope / relations:** mechanism by DIR-044 (single-source scripts); wiring by DIR-075;
  portable loop-driver support by DIR-049. The touches-disjoint constraint is the load-bearing
  safety property — without it, concurrent worktree merges would conflict on `master` (DIR-015).
