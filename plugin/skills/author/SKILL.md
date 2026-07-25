---
name: author
description: Use when driving a task at status `todo` toward `ready` — writes/reviews the four mandatory artifacts (Proposal, Plan, AC, DoD) and asserts the `todo -> ready` gate via `quay task check`. Does not execute the task (see quay:execute for `ready -> done`). Invoke with a task id and, optionally, a provider id (default `native`).
status: exercised
σ: 0.55
last_exercise: iteration-27
---

# quay:author

λ(taskId: TaskId, provider: ProviderId = "native") → AuthoringOutcome

Layer-2 orchestration Skill (quay-native-design.md §5) for the `todo` status.
Corresponds to the `author` operation in the status model (design §3):
`todo → ready ⟺ proposal ∧ plan ∧ AC ∧ DoD are all present and passed review`.

## Spec

```
AuthoringOutcome = ReachedReady | NeedsHuman(reason: String)

authorTask :: (TaskId, ProviderId) → AuthoringOutcome
authorTask(id, provider) = {
  task:     quay task view <id> --provider <provider> --json,
  assert:   task.status == "todo",
  -- Layer-1 operation Skills (design §5): each in its OWN subagent, fresh
  -- context, for review independence, WHEN the environment offers a
  -- dispatch-capable primitive (see "Environment capability" below). No
  -- such primitive was available in iteration 1's environment — the
  -- degraded fallback (same-session, checklist-based) ran instead.
  proposal: writeProposal(task),     -- step: write-proposal (see below)
  reviewed1: reviewProposal(proposal),  -- step: review-proposal (see below)
  plan:     writePlan(task, proposal),  -- step: write-plan (see below)
  reviewed2: reviewPlan(plan),          -- step: review-plan (see below;
                                        --   this is also where the decompose test lives,
                                        --   design §4 — "declare an epic only if >=2
                                        --   independently mergeable deliverables")
  gate:     quay task check <id> --provider <provider>,
  return:   case gate.ok of
    True  → { quay task edit <id> --status ready --provider <provider> ; ReachedReady }
    False → NeedsHuman(gate.reason)
}
```

## Method — formal signatures + constraint predicates (Layer-1 steps, design §5)

1. **`write-proposal`**
   ```
   writeProposal :: (Task, ProviderId) → Proposal
   writeProposal(task, provider) =
     quay task view <id> --provider <provider> --json
     ∃? ## Proposal → skip
     ¬∃? ## Proposal → write(what ∧ why ∧ approach ∧ grounded(readActualCode, notGenericFiller))
   ```
   -- Degraded: same-session direct write (no subagent-dispatch primitive found)

2. **`review-proposal`**
   ```
   reviewProposal :: (Proposal) → Verdict
   reviewProposal(p) =
     check(headingPresent(p) ∧ |p| > trivialFloor ∧ approachNamesSpecificGap(p) ∧ ¬genericLanguage(p))
   constraint ¬selfReview ∧ ¬sharedBlindSpot
   ```
   -- Degraded: same-session checklist re-read (no independent subagent available)

3. **`write-plan`**
   ```
   writePlan :: (Task, Proposal, ProviderId) → Plan
   writePlan(task, proposal, provider) =
     ∃? ## Plan → skip
     ¬∃? ## Plan → write(phasesConcretelyImplement(proposal.approach))
     decomposeTest: (|independentlyMergeableDeliverables| ≥ 2) ? createChildren : keepLeaf
   ```
   -- Degraded: same-session direct write (no subagent-dispatch primitive found)

4. **`review-plan`**
   ```
   reviewPlan :: (Plan, Task) → ReviewOutcome
   reviewPlan(plan, task) =
     check(planPhasesMapOntoAc(task) ∧ |acCheckboxes| ≥ 1 ∧ dodIsRealChecklist(task) ∧ ¬dodRestatesAc(task))
     ∃? ## AC → skip else writeAC(task)
     ∃? ## DoD → skip else writeDoD(defaults ∪ taskSpecific)
   constraint ¬selfReview ∧ ¬sharedBlindSpot
   ```
   -- Degraded: same-session checklist re-read (no independent subagent available)

5. **`gate-check`**
   ```
   gateCheck :: (TaskId, ProviderId) → GateOutcome
   gateCheck(id, provider) =
     quay task check <id> --provider <provider> --json
     case ok of
       True  → quay task edit <id> --status ready --provider <provider>
       False → ¬force ∧ (isHumanBlocker ? NeedsHuman : stayTodo)
   ```

## Gaps (honestly declared)

- **No unconditional subagent-dispatch primitive exists in this environment.**
  The `mcp__plugin_manda_manda__Agent` tool provides a conditional
  manda-proxied Agent (confirmed live: experiment 2, iterations 4-6), but it
  requires a live daemon AND a non-self broker (DIR-020). A reliable,
  unconditional native fresh-context spawn — what this Skill's
  `review-proposal`/`review-plan` steps actually need for genuine reviewer
  independence — does not exist. The degraded, same-session fallback remains
  this Skill's actual operating mode.

- **Same-session degraded review checklist is not a substitute for genuine
  reviewer independence.** The checklist-based review (steps 2 and 4) was
  real and actually run, but a same-session reviewer shares the author's
  blind spots by construction. This is why G3's out-of-band audit remains
  mandatory and non-optional even after this Skill's degraded mode reports
  success.

- **Not yet dispatched via manda in a background worker by this Skill
  itself.** Dispatch binding is currently the host's job (`quay action
  run`); this Skill is invoked directly inside whatever session receives
  that trigger.

- Resolved history: `author->ready` gate tightened to require checked-state not mere presence (QN-019); conditional manda Agent three-tier reliability envelope confirmed (experiment 2 iterations 4-6); decompose test exercised (iteration 27). See provenance.md for full per-iteration accounts.
