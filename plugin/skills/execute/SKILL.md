---
name: execute
description: Use when driving a task at status `ready` toward `done` — implements the plan, self-audits against AC/DoD, and asserts the `ready -> done` gate via `quay task check`. Takes the epic branch (drive children to done, then integration-accept) when the task's derived role is `compound`. Invoke with a task id and, optionally, a provider id (default `native`).
status: exercised
σ: 0.55
last_exercise: iteration-27
---

# quay:execute

λ(taskId: TaskId, provider: ProviderId = "native") → ExecutionOutcome

Layer-2 orchestration Skill (quay-native-design.md §5) for the `ready` status.
Corresponds to the `execute` operation in the status model (design §3):
`ready → done ⟺ AC satisfied ∧ DoD passed (integration acceptance for epics)`.

## Spec

```
ExecutionOutcome = Done | NeedsHuman(reason: String)

executeTask :: (TaskId, ProviderId) → ExecutionOutcome
executeTask(id, provider) = {
  task:    quay task view <id> --provider <provider> --json,
  assert:  task.status == "ready",
  role:    task.role,   -- DERIVED (design §2): children non-empty => compound
  return:  case role of
    "primitive" → executeLeaf(task, provider)
    "compound"  → executeEpic(task, provider)
}

-- Leaf path: implement the plan's Phases, TDD-style (borrowed discipline
-- from the seed's primitive-executor, scoped to quay-native's own tooling —
-- no epicd CLI calls).
executeLeaf :: (Task, ProviderId) → ExecutionOutcome
executeLeaf(task, provider) = {
  forEachPhase: implementPhaseRedGreen(task),   -- write/adjust tests, make them pass
  selfAudit:    reRunAC(task),                  -- check AC boxes only when actually verified true
  gate:         quay task check <id> --provider <provider>,
  return: case gate.ok of
    True  → { quay task edit <id> --status done --provider <provider> ; Done }
    False → NeedsHuman(gate.reason)
}

-- Compound (epic) path: design §4's execution process.
executeEpic :: (Task, ProviderId) → ExecutionOutcome
executeEpic(task, provider) = {
  ensureChildrenExist: task.children,           -- created at authoring or now, on a late split
  driveEach:  [ driveChildToDone(c, provider) | c <- task.children ],  -- recursive: todo->author->ready->execute->done
  integrationAccept: runEpicLevelACAndDoD(task),
  return: case integrationAccept of
    Pass → { quay task edit <id> --status done --provider <provider> ; Done }
    Fail → NeedsHuman("integration acceptance failed")
}
```

## Method — formal signatures + constraint predicates (leaf path only; epic path untested at v0)

1. **`implement-phase`**
   ```
   implementPhase :: (Task, ProviderId) → PlanOutcome
   implementPhase(task, provider) =
     ∀phase ∈ task.plan:
       writeTests(phase) →
       assert testsFailForExpectedReason() →
       implementMinimumChange() →
       assert testsPass()
   constraint ¬hangingOnStartup ∧ ¬crashingOnMalformedInput ∧ ¬silentMidSessionFailure
   ```
   -- Degraded: same-session sequential (no subagent-dispatch primitive found)

   **Negative-path sub-check** (standing consideration for any external-boundary phase; generalized from QN-062/063/064):
   ```
   negativeCheck :: (Phase) → (Open | AlreadyCovered | NotApplicable)
   negativeCheck(phase) =
     externalBoundary(phase) ?
       { ask(connectionStartup:   failure to start/connect propagated ¬hang∧¬crash?)
         ask(malformedInput:      degenerate external data handled without crash?)
         ask(liveMidSession:      mid-session failure surfaced without crash/silent-swallow?)
         recordAnswer(open | alreadyCovered | notApplicable) }
       : NotApplicable
   constraint ¬manufactureTest ∧ ¬skipQuestion
   ```

2. **`self-audit-ac`**
   ```
   selfAuditAc :: (Task, ProviderId) → AuditResult
   selfAuditAc(task, provider) =
     ∀ac ∈ task.acceptanceCriteria:
       reVerifyAgainstActualCode(ac) →
       toggleCheckbox(ac, verifiedIsTrue)
   constraint ¬trustPriorPass ∧ ¬assumeShouldWork ∧ ¬skipUncomfortable
   ```
   -- Degraded: same-session re-run (no independent subagent available)
   -- NOTE: necessary but INSUFFICIENT for G3 — requires separate fresh-context adjudicate co-sign

3. **`gate-check`**
   ```
   gateCheck :: (TaskId, ProviderId) → GateOutcome
   gateCheck(id, provider) =
     quay task check <id> --provider <provider> --json
     case ok of
       True  → quay task edit <id> --status done --provider <provider>
       False → ¬force ∧ report(reason) ∧ (isBlockerNotImplGap ? NeedsHuman : stayReady)
   ```

## Gaps (honestly declared)

- **No unconditional subagent-dispatch primitive exists in this environment.**
  The `mcp__plugin_manda_manda__Agent` tool provides a conditional
  manda-proxied Agent (confirmed live: experiment 2, iterations 4-6), but it
  requires a live daemon (`.manda/hub.addr` reachable) AND a non-self broker
  armed on the target channel (DIR-020). A reliable, unconditional native
  fresh-context spawn — what this Skill's `self-audit-ac` independence
  contract actually needs — does not exist. The degraded, same-session
  fallback remains this Skill's actual operating mode.

- **No independent adjudicate-style audit is built into this Skill itself.**
  Design §5's "review independence (no self-certification)" contract for
  execution is not enforced by tooling; it currently relies on a separate,
  explicitly-invoked audit pass (G3's out-of-band adjudicate), not on
  anything this Skill enforces mechanically. The `ready->done` gate
  transition produced by this Skill is provisional until a genuinely
  separate (fresh-context) adjudicate-style check co-signs it.

- **Not yet dispatched via manda in a background worker by this Skill
  itself.** Dispatch binding is currently the host's job (`quay action
  run`); this Skill is invoked directly inside whatever session receives
  that trigger.

- Resolved history: all `executeEpic` branches exercised (QN-017 leaf-fail, QN-020/QN-021 child-fail, QN-022/QN-023 integration-fail); compound-gate recursion fixed (QN-012 gate, QN-016 recursive stale-done); iteration-27 real Skill-level epic orchestration verified (gh-10/gh-8/gh-9); iteration-28 partial MCP stdio transport confirmed; three-tier manda Agent reliability envelope demonstrated (experiment 2 iterations 4-6); negative-path sub-check discipline fed back into Method step 1 (iteration 61). See provenance.md for full per-iteration accounts.
