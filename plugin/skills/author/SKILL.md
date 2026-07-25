---
name: author
description: Use when driving a task at status `todo` toward `ready` — writes/reviews the four mandatory artifacts (Proposal, Plan, AC, DoD) and asserts the `todo -> ready` gate via `quay task check`. Does not execute the task (see quay:execute for `ready -> done`). Invoke with a task id and, optionally, a provider id (default `native`).
status: exercised
σ: 0.40
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

## Method — four named Layer-1 steps, each with a stated environment-capability requirement and a degraded fallback (design §5: "A Skill declares the environment capability it needs and defines a degraded fallback for environments without it")

1. **`write-proposal`** — `quay task view <id> --provider <provider> --json`;
   if `## Proposal` is missing, write one: what/why, the approach, grounded
   in a real, specific gap (read the actual code/design, not a generic
   filler).
   - *Dispatch-capable target:* run in its own fresh-context subagent.
   - *Degraded fallback (currently active — no dispatch primitive found in
     this environment):* write it directly in the current session.
2. **`review-proposal`** — check the Proposal for internal consistency
   before proceeding.
   - *Dispatch-capable target:* an independent subagent, reading only the
     artifact (not the writer's reasoning), issues a verdict.
   - *Degraded fallback (currently active):* a same-session re-read pass
     against a concrete checklist: (a) heading present, (b) content exceeds
     a trivial-length floor (not a one-word placeholder), (c) the approach
     names a specific, real gap rather than generic language. This is
     weaker than true independence and is named as such — see Gaps.
3. **`write-plan`** — if `## Plan` is missing, write one: phases/stages that
   concretely implement the Proposal's approach. This is also where the
   **decompose test** (design §4) applies: declare an epic (create `children`
   tasks) only if ≥2 independently mergeable deliverables are named;
   otherwise keep it a single-leaf plan.
   - *Dispatch-capable target:* own fresh-context subagent.
   - *Degraded fallback (currently active):* written directly in-session.
4. **`review-plan`** — check the Plan for internal consistency and correct
   decompose-test application; write `## AC` (machine-checkable checkboxes)
   and `## DoD` (defaults ∪ task-specific) if missing, since these are
   plan-derived artifacts.
   - *Dispatch-capable target:* independent subagent verdict.
   - *Degraded fallback (currently active):* same-session checklist: (a)
     Plan phases map onto AC items, (b) AC section contains ≥1 real
     checkbox line, (c) DoD is a real checklist, not restated AC.
5. `quay task check <id> --provider <provider> --json` — if `ok: true`, run
   `quay task edit <id> --status ready --provider <provider>`. If `ok:
   false`, do not force it; leave at `todo` (or move to `needs-human` if a
   human blocker exists) and report the gate's `reason`.

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
