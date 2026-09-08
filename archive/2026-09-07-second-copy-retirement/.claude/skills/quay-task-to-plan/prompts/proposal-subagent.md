# proposal-subagent — parametrized Task-agent prompt (Stage 6.2)

This is a **template**, not a script. The orchestrating skill (`SKILL.md`
step 2) fills in the `{{...}}` placeholders and dispatches this as an
independent Task-agent run — **one dispatch per subagent index `i` in
`1..N`** (default `N=2`), each in its own isolated context. Do NOT show one
subagent's output to another. Do NOT run these concurrently in a way that
lets them observe each other's intermediate state — independence is the
point (divergence is only a real signal if the agents genuinely did not
anchor on each other).

## Parameters

- `{{N}}` — total subagent count for this dispatch (default `2`).
- `{{i}}` — this subagent's 1-based index (`1..{{N}}`).
- `{{persona}}` — a short differentiation instruction (see "Default personas"
  below). Persona differentiation is a cheap diversity widener, not a
  guarantee of divergence — real convergence is a valid, expected outcome
  and must be reported honestly, not forced apart.
- `{{task_id}}` — the target task's id (e.g. `QX-041`).
- `{{task_title}}` — the task's current title, verbatim from `task_get`.
- `{{task_body}}` — the task's current `body`, verbatim from `task_get`
  (may already contain a stale `## Proposal` section from a prior run — see
  note below).
- `{{task_labels}}` — the task's current labels, verbatim from `task_get`.
- `{{milestone_charter_or_candidate}}` — either the milestone charter's full
  text (if one exists yet for this task's milestone) or the raw backlog
  candidate description (if pre-charter). Whichever is available — never
  both, never neither.

## Prompt body (dispatch verbatim with parameters substituted)

```
You are proposal-author {{i}} of {{N}} for task {{task_id}} ("{{task_title}}").

You are working BLIND to any other proposal author — there is no other
agent's output available to you, and there will not be. Do not attempt to
imagine or hedge against "what another agent might propose"; author your own
independent, best-effort approach.

Persona / framing for this pass: {{persona}}

Task context (read-only; you MUST NOT call task_write or any other mutating
tool in this pass — proposal authoring is read-only, write-back happens in a
LATER, SEPARATE adjudication step you are not part of):

- Task id: {{task_id}}
- Title: {{task_title}}
- Labels: {{task_labels}}
- Current body (may include a stale `## Proposal` section from a prior
  regeneration cycle — if so, treat it as historical context only, not a
  constraint; you are re-deriving a fresh proposal, not incrementally
  patching the old one):
  {{task_body}}
- Milestone charter or candidate description:
  {{milestone_charter_or_candidate}}

Your job: author a proposal for HOW to approach this task — problem framing,
approach, key design decisions, and an explicit list of alternatives you
considered and rejected (this list matters: adjudication will preserve it
even if your approach is not the one selected). Do not implement code. Do not
write to the task. Output ONLY the proposal content, in this shape (matching
the write-back shape adjudication will later use):

  Problem framing: <1-3 sentences>
  Approach: <the approach you propose>
  Key design decisions: <bullet list>
  Alternatives considered and rejected: <bullet list, each with a one-line
    reason for rejection — do not omit this even if you only seriously
    considered one alternative>

Return this as your final output. Do not call task_write, task_check, or any
other tool that mutates state.
```

## Default personas (N=2 default dispatch)

1. **Persona A — "minimal-surface-area."** `{{persona}}` = "Propose the
   approach with the smallest possible surface area: fewest new files/
   abstractions/config knobs, reusing existing mechanisms wherever the task
   allows, even if it means the solution is narrower in scope than a
   from-scratch redesign would be."
2. **Persona B — "pattern-consistency."** `{{persona}}` = "Propose the
   approach most consistent with existing patterns already established
   elsewhere in this codebase/experiment, even if that means introducing a
   new file or abstraction that mirrors an existing precedent, rather than
   forcing the solution into the smallest possible diff."

For `N > 2` (only when a task is explicitly flagged high-stakes at SELECT
time, per `SKILL.md`'s N=2-default rule), add further personas at the
milestone author's discretion (e.g. "propose the approach that most reduces
future migration risk") — never silently; state the added persona and why
in the milestone record.

## Non-goals for this template

- Does not decide N (that is `SKILL.md` step 2's job, reading the SELECT-time
  flag).
- Does not perform adjudication (that is `adjudicate-proposal.md`, a
  separate template, dispatched only after ALL N proposal subagents finish).
- Does not write to the task (write-back is exclusively the adjudication
  step's job — see `SKILL.md` step 3, "never by either of the N proposal
  subagents directly," to avoid a race/overwrite hazard between concurrent
  writers).
