# Proposal subagent prompt template (parametrized by N, PERSONA)

This is the prompt body dispatched to **each of the N independent proposal
subagents** (default N=2) by `quay-task-to-plan`'s proposal step (SKILL.md §2).
Each subagent is a **separate Task-agent invocation with no shared context** —
do not run two personas in the same conversation thread, and do not let a later
subagent see an earlier subagent's output. That separation is the entire point:
divergence between independently-derived proposals is the signal this step
exists to surface (proposal §13.1 step 1, §6's "no inter-agent communication"
requirement). If you find yourself tempted to "save a round trip" by drafting
both proposals in one thread, stop — that silently destroys the signal.

## Inputs the dispatcher fills in per subagent

- `{{TASK_ID}}`, `{{TASK_TITLE}}`, `{{TASK_BODY}}`, `{{TASK_LABELS}}` — from a
  fresh `mcp__quay__task_get {{TASK_ID}}` call, read once per proposal round
  (not reused across a later regeneration — re-read fresh each time this step
  runs, since the task may have changed).
- `{{MILESTONE_CHARTER}}` — the owning milestone's charter file contents if one
  already exists, else the raw candidate/backlog description the task was
  drafted from. Never fabricated if neither exists — state "no charter or
  candidate description available" explicitly rather than inventing context.
- `{{PERSONA}}` — one of a small fixed set of persona labels, assigned by the
  dispatcher, one per subagent, never repeated within one N-fan-out:
  - `minimal-surface-area` — "Propose the approach that changes the fewest
    files / introduces the fewest new concepts / has the smallest blast
    radius, even if it is not the most elegant or future-proof option.
    State explicitly what you are declining to generalize and why."
  - `pattern-consistent` — "Propose the approach most consistent with
    existing patterns already used elsewhere in this codebase for
    structurally similar problems. Cite the specific existing file(s)/
    pattern(s) you are mirroring. Prefer reuse over a novel mechanism even
    if a novel mechanism would be marginally cleaner in isolation."
  - Additional personas MAY be added by a future revision (e.g.
    `performance-first`, `test-first`) if a milestone's SELECT-time
    high-stakes flag raises N above 2 — assign one persona per subagent,
    never blend two personas into one subagent's prompt.

## The prompt body (verbatim, `{{...}}` substituted by the dispatcher)

```
You are drafting ONE independent design proposal for a single quay task. You
will NOT see any other proposal for this task — another agent, working from
the same inputs, is independently drafting a second proposal in a separate,
unconnected context. Do not try to guess or hedge toward what "the other"
proposal might say; draft the approach YOU think is correct, argued on its own
merits. This isolation is intentional: the whole value of this step is
capturing genuine independent judgment, not a converged-in-advance consensus.

Task id: {{TASK_ID}}
Task title: {{TASK_TITLE}}
Task labels: {{TASK_LABELS}}

Task body (current, verbatim):
---
{{TASK_BODY}}
---

Owning milestone charter / candidate description (context only — do not
re-litigate or expand this milestone's already-fixed scope; propose HOW to
build what it asks for, not whether to build something else):
---
{{MILESTONE_CHARTER}}
---

Your assigned persona for this proposal: {{PERSONA}}
(See the persona instruction text above for what this means concretely —
follow it as a genuine lens on the problem, not a label to mention once and
ignore.)

Draft a proposal covering:
1. Problem framing — what this task is actually asking for, in your own words
   (a sanity check that you read it correctly).
2. Approach — the concrete design/implementation approach you propose,
   specific enough that a plan could be authored from it directly.
3. Key design decisions — the 2-5 choices that most shape the approach, and
   why you made them.
4. Alternatives considered and rejected — list every materially different
   alternative approach you considered, even briefly, and why you rejected
   it. This list is NOT optional filler — the adjudication step that reads
   your proposal alongside the other subagent's proposal relies on this list
   being real and specific; a thin or fabricated list defeats the purpose of
   running two independent agents at all.

Do NOT call task_write or any other task-mutating tool. Your job ends at
producing the proposal text; a separate adjudication step (a different agent
invocation) is responsible for reconciling proposals and writing back to the
task. Output only the proposal text (problem framing / approach / key
decisions / alternatives-considered-and-rejected) — no commit, no file writes
beyond returning your answer as this invocation's output.
```

## Output contract

The subagent returns plain proposal text (the four numbered sections above) as
its final response. The dispatcher collects this text verbatim per subagent —
it does not summarize or truncate it before handing both raw proposals to the
adjudication step (`prompts/adjudicate-proposal.md`); adjudication needs the
full alternatives-considered-and-rejected lists from both proposals intact.
