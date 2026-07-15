---
name: quay:author
description: Use when driving a quay-native task at status `todo` toward `ready` — writes/reviews the four mandatory artifacts (Proposal, Plan, AC, DoD) and asserts the `todo -> ready` gate via `quay-native task check`. Does not execute the task (see quay:execute for `ready -> done`). Invoke with a task id.
---

# quay:author

λ(taskId: TaskId) → AuthoringOutcome

Layer-2 orchestration Skill (quay-native-design.md §5) for the `todo` status.
Corresponds to the `author` operation in the status model (design §3):
`todo → ready ⟺ proposal ∧ plan ∧ AC ∧ DoD are all present and passed review`.

**Honesty note (iteration 1 / σ rising):** this Skill was written in
iteration 0 as a v0 port of the seed's `authoring-convergence` (epicd) and
was, at that point, entirely unexercised. **Iteration 1 actually dispatched
this Skill's method against real tasks** (QN-001, QN-003, QN-005 — see
`experiment/provenance.md`), authoring real Proposal/Plan/AC/DoD content and
passing each through `quay-native task check`. A concrete environment finding
came out of that exercise: **this environment (the tool-calling harness
driving this session) has no subagent-dispatch primitive** — an explicit
`ToolSearch` check for a `Task`/`Agent`-equivalent tool during iteration 1
found none. This means the fresh-context isolation design §5 calls for
("Layer-1 operation Skills... each in its own subagent") could not be
achieved for real in iteration 1; the four steps below ran sequentially in
one session, with a same-session review checklist substituting for genuine
reviewer independence. This is recorded here, not hidden — see "Gaps".

## Spec

```
AuthoringOutcome = ReachedReady | NeedsHuman(reason: String)

authorTask :: TaskId → AuthoringOutcome
authorTask(id) = {
  task:     quay-native task get <id> --json,
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
  gate:     quay-native task check <id>,
  return:   case gate.ok of
    True  → { quay-native task edit <id> --status ready ; ReachedReady }
    False → NeedsHuman(gate.reason)
}
```

## Method — four named Layer-1 steps, each with a stated environment-capability requirement and a degraded fallback (design §5: "A Skill declares the environment capability it needs and defines a degraded fallback for environments without it")

1. **`write-proposal`** — `quay-native task get <id> --json`; if `## Proposal`
   is missing, write one: what/why, the approach, grounded in a real,
   specific gap (read the actual code/design, not a generic filler).
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
5. `quay-native task check <id> --json` — if `ok: true`, run
   `quay-native task edit <id> --status ready`. If `ok: false`, do not force
   it; leave at `todo` (or move to `needs-human` if a human blocker exists)
   and report the gate's `reason`.

## Gaps (honestly declared, not hidden — feeds iteration 2's OBSERVE step)

- **No subagent-dispatch primitive exists in this environment** (confirmed
  by iteration 1's explicit `ToolSearch` check — not assumed). This is the
  actual, demonstrated blocker for design §5's fresh-context/review-
  independence contract — not merely "Layer-1 Skills aren't separate files
  yet" (iteration 0's framing). Splitting Layer-1 into standalone
  dispatchable `.md` files (as iteration 0 anticipated) would not by itself
  fix this — there would still be nothing to dispatch them *to* in this
  environment. This is an environment/harness capability gap, out of
  quay-native's own control; the Skill's contract (declare the requirement,
  degrade honestly) is the correct response per design §5, not a workaround
  for the missing primitive itself.
- The same-session degraded-mode review checklist (steps 2 and 4 above) is
  real and was actually run for QN-001/QN-003/QN-005 in iteration 1, but it
  is **not** a substitute for genuine reviewer independence — a same-session
  reviewer shares the author's blind spots by construction. This is exactly
  why G3's out-of-band audit (a separately-dispatched, fresh-context check)
  remains mandatory and non-optional even after this Skill's degraded mode
  reports success.
- The decompose test (design §4) has been **stated** in step 3 above but was
  not exercised against a real ≥2-deliverable case in iteration 1 — all
  three tasks authored this iteration (QN-001, QN-003, QN-005) were single-
  leaf. The epic/compound branch remains untested for authoring, same as it
  is for `quay:execute` (see that Skill's own Gaps).
- Not yet dispatched via manda in a background worker session by this Skill
  itself — dispatch is currently the host's job (`quay action run`), and this
  Skill is invoked directly inside whatever session receives that trigger.
