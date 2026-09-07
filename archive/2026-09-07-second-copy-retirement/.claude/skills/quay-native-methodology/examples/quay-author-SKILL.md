---
name: quay:author
description: Use when driving a task at status `todo` toward `ready` — writes/reviews the four mandatory artifacts (Proposal, Plan, AC, DoD) and asserts the `todo -> ready` gate via `quay task check`. Does not execute the task (see quay:execute for `ready -> done`). Invoke with a task id and, optionally, a provider id (default `native`).
---

# quay:author

λ(taskId: TaskId, provider: ProviderId = "native") → AuthoringOutcome

Layer-2 orchestration Skill (quay-native-design.md §5) for the `todo` status.
Corresponds to the `author` operation in the status model (design §3):
`todo → ready ⟺ proposal ∧ plan ∧ AC ∧ DoD are all present and passed review`.

**Honesty note (iteration 1 / σ rising):** this Skill was written in
iteration 0 as a v0 port of the seed's `authoring-convergence` (epicd) and
was, at that point, entirely unexercised. **Iteration 1 actually dispatched
this Skill's method against real tasks** (QN-001, QN-003, QN-005 — see
`experiments/quay-native-bootstrap/provenance.md`), authoring real Proposal/Plan/AC/DoD content and
passing each through the gate. A concrete environment finding came out of
that exercise: **this environment (the tool-calling harness driving this
session) has no subagent-dispatch primitive** — an explicit `ToolSearch`
check for a `Task`/`Agent`-equivalent tool during iteration 1 found none.
This means the fresh-context isolation design §5 calls for ("Layer-1
operation Skills... each in its own subagent") could not be achieved for
real in iteration 1; the four steps below ran sequentially in one session,
with a same-session review checklist substituting for genuine reviewer
independence. This is recorded here, not hidden — see "Gaps".

**Honesty note (iteration 18, QN-029) — provider-parameterized.** Every
Method step below previously hardcoded `quay-native task <cmd>`, invoking
`quay-native`'s own CLI directly. This was a real, undeclared limitation:
declaring quay-github's `skill` capability without fixing it would have
been a config-only, semantically-empty change (the composed action-button
payload would name this Skill, but invoking it against a GitHub-backed
task id would silently target the wrong Provider's data). QN-029 replaced
every such invocation with Core's own already-existing, provider-agnostic
CLI passthrough — `quay task <cmd> --provider <provider>` (`packages/quay/
bin/quay.js`'s `withProvider` helper, live since QN-024/QN-027) — so this
Skill now genuinely operates against whichever Provider it is told to
target. Default is `native` (unchanged from every prior iteration's
invocation); `quay task <cmd> --provider native --json` is confirmed
byte-identical to the pre-existing direct `quay-native task <cmd> --json`
invocation (see `experiments/quay-native-bootstrap/iterations/iteration-18.md` §Phase 3 for the
verbatim regression proof) — no prior provenance record or prior
iteration's evidence is invalidated by this change. This is the actual
mechanism that makes `quay-github`'s own `status_skill_map` declaration
(this same task, Phase 4) honest rather than aspirational.

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
- **Fixed in iteration 8 (QN-019):** the `author->ready` gate (`store.js`'s
  `check()` "todo" branch) previously tested the AC section only for
  checkbox **presence**, not checked-**state** — a task could reach `ready`
  with zero AC boxes actually checked, so long as at least one checkbox
  line existed. This asymmetry with the `execute->done` gate (which already
  required full-checked state) was found live by iteration 7's QN-017 (the
  first genuine `needs-human` exercise): its author-gate unexpectedly passed
  with 0/2 AC boxes checked, because the gate at that time only checked
  presence. The gate now requires **all** AC checkboxes checked before
  `author->ready` passes, with a distinct `"N/M AC checkboxes checked"`
  reason string, matching `execute->done`'s existing reason format. See
  `packages/quay-native/test/gate-checked-state.test.mjs` for dedicated
  coverage, including the exact previously-passing/now-correctly-failing
  case. **Note:** this closes the narrow "checked vs. merely present"
  mechanical asymmetry only — the deeper "checkbox-count gameability" gap
  (an author could check a box without independent verification the
  underlying claim is true) remains open; the gate is still both contestant
  and judge for this class of claim (G3).
- **Update (iteration 14) — sharpened, not reversed: an async task-queue
  dispatch primitive (`manda` `Dispatch`/`DispatchStatus`/`DispatchSettle`)
  was confirmed live starting iteration 13 (DIR-004), but the genuine
  synchronous fresh-context `Agent` spawn this Skill's `review-proposal`/
  `review-plan` steps actually need for true independence was tested
  directly in iteration 14 and did **not** complete (two independent
  calls, both timed out after 30s waiting on the `agent.spawn`
  capability — see `experiments/quay-native-bootstrap/directives/README.md`'s iteration-14
  update for the full account). The degraded, same-session fallback
  documented above therefore remains this Skill's actual operating mode
  as of iteration 14, not merely a historical iteration-1 finding that
  might now be stale.
