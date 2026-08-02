# Exp6 Proposal Review: Mapping Queue Principles to Proposal Gaps

**Date:** 2026-08-01
**Source principles:** Orchestrator session (`8e4b1f78`), 2026-08-01T12:29:09
**Target proposal:** `docs/proposals/exp6-queue-driven-concurrent-executor.md`

## The Five Principles

From the orchestrator session's summary of epoch fingerprint escalation handling:

```
P1. 关键性优先于上限 — before retrying, ask: is this task's change critical for execute-milestone?
P2. 在创建新纪元之前诊断原因 — the cap tells you THAT failure is repeating, not WHY
P3. 强制提交是有效工具 — when blockers are non-critical, force-commit with a durable reason record
P4. 在 N 次重置时停止，而不是在 N 次尝试时停止 — stop at reset count, only reset when the fix changes what ProposalReview sees
P5. 跨任务指纹是危险信号 — same fingerprint across 9+ tasks = systemic root cause, stop per-task fixes
```

These are **operational principles derived from live execution stress**. They weren't designed in advance — they emerged from managing 9+ simultaneous prepare-milestone tasks hitting the same capacity wall.

## Gap Analysis: What the Principles Reveal About the Exp6 Proposal

### Gap 1: The "Criticality" Question is Absent from the State Machine

**Principle P1** says: before spending more resources on a stuck task, ask whether it's **critical** for the execute-milestone phase.

The exp6 proposal's state machine (§3.2) is:

```
queued → prepare(running) → prepare(done) → execute(running) → ...
```

It has no **conditional branch** for "prepare concluded: changes are non-critical → skip execute." This forces every task through the full pipeline even when a force-commit is the right call.

**Evidence from live operation:** A2 (M243) and A5 (M246) both hit the epoch cap. The orchestrator applied P1 — A5's remaining AC coverage gap was about a replay corpus consumed by downstream tasks (B/C/D/E), not about the execution engine itself. Force-commit, no new epoch. Wall-clock savings: ~45 minutes per task.

**Proposed fix for §3.2:**

Add a **`criticalityGate`** transition between `prepare(done)` and `execute(running)`:

```
prepare(done)
  ├─ criticalityGate = "is this task's output critical for execute-milestone?"
  │   ├─ YES → execute(running)     (normal path)
  │   └─ NO  → forceCommit → done  (bypass execution, record reason)
  └─ (optional) needsHuman if unclear
```

The criticality classification should be mechanized, not left to LLM judgment. Semantics: does this task touch any file in `## Touches` that `execute-milestone.js` imports? Does it modify gate scripts, the Land lock, or the Build/Audit/Gate pipeline? If no → non-critical.

### Gap 2: Fingerprint-Based Diagnostics are Not in the Proposal

**Principles P2, P5** are about **pattern recognition across tasks** — same fingerprint across multiple tasks, same subsystem failure repeating, systemic vs per-task root causes.

The exp6 proposal's `state.json` (§3.5) records per-task status but has no **cross-task diagnostic field** — no fingerprint, no rootCauseKey, no mechanism ID. The `history.jsonl` is an append-only event log with no aggregation query capability.

**Evidence from live operation:** Fingerprint `4161ab22b641` (wiring coverage gap) appeared across A2 and A5 simultaneously. This was correctly diagnosed as systemic — both tasks were chartered before DIR-124-A1 (the parent that would resolve the wiring template) landed. The fix was to force-commit both, not to keep patching each individually.

Without cross-task fingerprint tracking, exp6 would independently retry each task N times before reaching the same conclusion — wasting N× the resources.

**Proposed fix for §3.5:**

Extend `state.json` with a **cross-task diagnostics layer**:

```json
{
  "tasks": { ... },
  "diagnostics": {
    "fingerprints": {
      "4161ab22b641": {
        "kind": "wiring-coverage-gap",
        "subsystem": "proposal-convergence.ts",
        "taskIds": ["DIR-124-A2", "DIR-124-A5"],
        "firstSeen": "2026-08-01T10:00:00Z",
        "lastSeen": "2026-08-01T11:45:00Z",
        "disposition": "force-commit-all — systemic: chartered before A1 landed"
      }
    },
    "systemicFlags": [
      {"reason": "3+ tasks share fingerprint X while dependency DIR-Y is incomplete"}
    ]
  }
}
```

And a **fingerprint-aggregation query** in `scripts/pipeline-router.ts` (§5.6): before dispatching a task's retry, check if its current fingerprint is shared by ≥3 other tasks. If yes → flag as systemic, halt per-task retries, route to dependency resolution.

### Gap 3: The Force-Commit Path is Underspecified

**Principle P3** says force-commit is a valid tool with a **durable reason record**. The exp6 proposal mentions `--record-split-decision --decision commit` in the split-decision context (§5.1) but doesn't integrate it into the core state machine or the proposal's own throughput projections.

Specifically missing:
1. **What generates the reason?** Currently it's the human typing a sentence. Should be template-mechanized: `"Non-critical for execute-milestone: task touches only {files}, none imported by execute-milestone.js"`
2. **Where is the reason persisted?** Currently in the task body as an ad-hoc note. Should be in `state.json` + `history.jsonl` + the task's `## Disposition` section.
3. **Who consumes the reason?** Currently no one. Future prepare-milestone runs for sibling tasks should read it to avoid re-discovering the same non-criticality.

**Proposed fix:** Extend §3.6 (human interaction surface) with a `queue.forceCommit(taskId, reason)` operation and make it a first-class state transition alongside the normal prepare→execute→land path.

### Gap 4: "Repairable" vs "Systemic" Classification is Missing

**Principles P2, P4** rely on a classification the exp6 proposal's `dispatch-router.ts` (§5.1) partially addresses — `repairable: true/false`. But the live data shows a more nuanced taxonomy is needed:

| Finding type | What it means | Correct action | Live example |
|---|---|---|---|
| `repairable` | Fix is local, one-shot, doesn't require structural change | Auto-fix, retry | Missing `## Touches` entry (add the line) |
| `same-fingerprint` | Same gap as previous run — fix didn't change what ProposalReview sees | Stop retrying, diagnose fix effectiveness | A2's 3rd retry with same wiring coverage gap |
| `different-fingerprint, same-subsystem` | Fix worked, exposed new gap in same area | Progress — continue | A2: AC expansion changed fingerprint → revealed missing plan file |
| `cross-task-same-fingerprint` | ≥3 tasks share this fingerprint | Stop all per-task fixes, resolve systemic cause | DIR-124 family: all chartered before A1 landed |
| `non-critical-blocker` | Blocker exists but doesn't affect execute-milestone | Force-commit | A5's commandIdentity wiring format |

The proposal's `dispatch-router.ts` only distinguishes `repairable: true/false`. This misses three of the five categories observed in practice.

**Proposed fix for §5.1:**

Extend the dispatch router's classification to a five-way taxonomy, with per-category routing:

```
route(finding) →
  repairable              → autoFix + retry (max 1 auto-fix attempt)
  sameFingerprintRepeat   → diagnoseFixEffectiveness → if fix didn't change ProposalReview surface → forceCommit or split
  sameSubsystemProgress   → continue retry (different fingerprint means real progress)
  crossTaskSystemic       → halt all affected tasks → resolve root dependency → retry all
  nonCriticalBlocker      → forceCommit with mechanistic reason generation
```

### Gap 5: Epoch Management is a Task Queue Concern, Not a Prepare-Milestone Internal

The exp6 proposal treats the epoch review cap as a prepare-milestone internal mechanism — mentioned only indirectly via "manual takeover" (§5.2). But the live data shows the epoch cap is actually a **queue-level scheduling concern**:

- When 9 tasks simultaneously hit the epoch cap, it's not that each individual prepare-milestone failed — it's that the **queue dispatched too many similar tasks into the same epoch** without capacity planning.
- The correct fix is at the queue level: before dispatching the N-th task into an epoch that's already at 80% capacity, check whether the remaining budget can handle it. If not, defer to the next epoch (or create a new one proactively).

**Proposed fix:** Add to §3.4 (resource-aware scheduling) an **epoch capacity** resource:

```
resources = {
  llm: {maxConcurrent: 4},
  shell: {maxConcurrent: 8},
  git: {maxConcurrent: 1},
  worktree: {maxConcurrent: 6},
  epochReviewBudget: {maxFullReviewsPerEpoch: 30, highWatermark: 0.8},
}
```

When `epochReviewBudget` reaches `highWatermark`, the scheduler auto-creates a new epoch for the next task rather than waiting for the cap to be hit and requiring manual takeover.

### Gap 6: The Principles Themselves Should be Mechanized, Not Documented

The five principles were summarized as **prose** in an assistant response. They exist only in session context — when the session compacts, they're gone. The next orchestrator session has to rediscover them.

The exp6 proposal's §5 identifies "prose-driven" control flow as a defect to fix, but **doesn't include these operational principles in the list of things to mechanize**. The principles are themselves prose-driven — they should be encoded as dispatch rules.

**Proposed fix:** Add a §5.7 to the proposal: "Operational Principles Mechanization." The five principles should become:

1. `criticality-gate.ts` — classifies task as execute-critical vs infrastructure-only (P1)
2. `fingerprint-aggregator.ts` — cross-task fingerprint tracking with systemic flag (P2, P5)
3. `force-commit-reason.ts` — generates mechanistic force-commit reason from task metadata (P3)
4. `retry-effectiveness-check.ts` — verifies fix changed ProposalReview surface before counting as a retry (P4)

---

## Structural Gaps in the Exp6 Architecture

### Gap A: No Feedback from Execution Back to Preparation

The current proposal has separate prepare and execute stages but no **feedback loop** where execute-milestone discoveries inform future prepare-milestone dispatch. The five principles were discovered DURING execution — they should flow back into the preparation pipeline.

**Proposal:** Add a `postLandFeedback` hook in the queue state machine:

```
land(done) → postLandFeedback
  → extractFingerprints(ledger)
  → updateDiagnosticsDB(fingerprints, dispositions)
  → if systemicPatternDetected: suppressMatchingPrepareDispatches()
```

### Gap B: The Queue's "Idle Detection" is Too Late

§9.1 says the loop triggers select-preflight "when queue is empty." But the live data shows the queue was never empty on Aug 1 — it was **full of stuck tasks**. "Queue is empty" is the wrong trigger; the right trigger is "queue has no unblocked ready tasks."

**Proposal:** Change the idle detection from `queue.isEmpty()` to `queue.hasNoUnblockedReady()` — i.e., all pending tasks are blocked by dependencies, epoch caps, or resource limits, and the queue needs diagnosis + new candidate injection, not just waiting.

### Gap C: The Cross-Compact Recovery Doesn't Cover "Orchestration State"

§5.5 (`session-restore.ts`) recovers task states from `state.json`. But the orchestrator session's **operational state** — the active queue ordering, the concurrency policy, the auto-approve settings, the human decisions about force-commit vs retry — is not in `state.json`. It exists only in the orchestrator's session context.

**Proposal:** Add an `orchestrationPolicy` section to `state.json`:

```json
{
  "orchestrationPolicy": {
    "concurrency": 4,
    "autoApproveNonCriticalForceCommit": true,
    "autoApproveSplitRecommended": true,
    "haltOnSystemicFingerprint": true,
    "maxRetriesBeforeDiagnosis": 2,
    "lastModifiedBy": "human",
    "lastModifiedAt": "2026-08-01T10:59:00Z"
  }
}
```

This makes the fleet commander's policy decisions survive compact, so the next orchestrator session doesn't revert to "ask human about every split decision."

---

## Recommended Additions to the Exp6 Proposal

### 1. New Section: "Operational Principles from Exp5 Fleet Execution" (before §3)

Document the five principles as **derived requirements** — these are not aspirational design goals but **observed necessary behaviors** from live operation under load. The architecture must satisfy them.

### 2. New Resource Type in §3.4: Epoch Capacity

Add `epochReviewBudget` as a schedulable resource with auto-escalation at high watermark.

### 3. New State Machine Transition in §3.2: Criticality Gate

Add the `criticalityGate` conditional branch between prepare(done) and execute(running).

### 4. Extended §5.1 Dispatch Router: Five-Way Classification

Replace the binary `repairable: true/false` with the five-way taxonomy observed in practice.

### 5. New §5.7: Operational Principles Mechanization

Encode P1-P5 as mechanized scripts, not session-context prose.

### 6. Extended §3.5 State Schema: Diagnostics + Policy

Add cross-task fingerprint aggregation and orchestrator policy persistence.

### 7. New §3.8: Post-Land Feedback Loop

Add the execute→prepare feedback path — execution discoveries inform preparation dispatch.

### 8. Revised §9.1 Idle Detection Trigger

Change from "queue is empty" to "queue has no unblocked ready tasks."

---

## Priority Matrix for These Changes

| Change | Why Now | Effort |
|---|---|---|
| Criticality gate (P1) | Most immediate throughput gain — prevents wasting execute time on non-critical tasks | Medium |
| Five-way dispatch classification (P2, P4, P5) | Prevents 8× retry pattern observed with DIR-099 | Medium |
| Orchestration policy persistence (Gap C) | Without this, compact = reset to manual mode | Small |
| Epoch capacity resource (Gap 5) | Directly addresses the Aug 1 100% manual-takeover bottleneck | Small |
| Cross-task fingerprint DB (Gap 2) | Needed before next large batch dispatch | Medium |
| Post-land feedback loop (Gap A) | Architectural — should be in phase 0 protocol design | Large |
| Principles mechanization (Gap 6) | Implements P1-P5 as code — can be done incrementally | Small per script |
| Idle detection fix (Gap B) | Trivial trigger change, large operational impact | Trivial |

---

## Conclusion

The exp6 proposal correctly diagnoses exp5's structural defects (global barriers, prose-driven decisions, compact fragility) and proposes a sound queue-driven architecture. The five principles from live operation validate this direction — a queue-driven model is exactly what's needed to handle the epoch cap management, cross-task diagnostics, and policy persistence that the current fixed-cycle model can't support.

However, the principles also reveal gaps that should be closed before implementation begins:

1. **The state machine needs a criticality branch** — not all tasks that complete prepare need to go through execute
2. **Cross-task diagnostics are a first-class requirement** — the queue needs to see patterns across tasks, not just per-task state
3. **The orchestrator's policies must survive compact** — concurrency settings and auto-approval decisions are operational state, not session context
4. **The epoch cap is a queue scheduling problem** — proactive capacity management, not reactive manual takeover
5. **The principles themselves need mechanization** — they're currently prose in session context, exactly the defect §5 sets out to fix
