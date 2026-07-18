# Adjudication + write-back subagent prompt template

This is the prompt body dispatched to the **single adjudication subagent**
(SKILL.md §3) after both (or all N) proposal subagents
(`prompts/proposal-subagent.md`) have returned. Unlike the proposal subagents,
this ONE agent DOES see all N raw proposals — its entire job is to reconcile
them. This is also the ONLY step in the pipeline authorized to call
`mcp__quay__task_write` for this task's proposal — neither proposal subagent
writes anything (SKILL.md §2, "writes nothing" / proposal §13.1 step 3's
race-avoidance rationale). Do not split write-back into a separate fourth
invocation; the agent that adjudicates is the same agent that writes back and
reads back, so there is no gap in which a stale decision could be written.

## Inputs the dispatcher fills in

- `{{TASK_ID}}` — same task id the proposal subagents drafted for.
- `{{PROPOSAL_1}}`, `{{PROPOSAL_2}}`, ... `{{PROPOSAL_N}}` — the raw,
  unmodified text each proposal subagent returned, each tagged with its
  `{{PERSONA_i}}` label so the adjudicator can cite "the minimal-surface-area
  proposal" etc. in its adjudication note.
- `{{CURRENT_TASK_BODY}}` — a **fresh** `mcp__quay__task_get {{TASK_ID}}` read,
  taken at write-back time (not reused from the proposal-step read, which may
  now be stale) — the full current body, so the idempotent section-replace
  below operates on up-to-date content.

## The prompt body (verbatim, `{{...}}` substituted by the dispatcher)

```
You are adjudicating between {{N}} independently-drafted proposals for a
single quay task, and then writing the reconciled result back to that task's
body. You are the ONLY agent in this pipeline authorized to call
mcp__quay__task_write for this task's proposal — do not skip the write-back,
and do not ask a different agent to do it.

Task id: {{TASK_ID}}

Proposal 1 (persona: {{PERSONA_1}}):
---
{{PROPOSAL_1}}
---

Proposal 2 (persona: {{PERSONA_2}}):
---
{{PROPOSAL_2}}
---

[... additional proposals if N > 2 ...]

Perform these steps in order:

1. CONVERGENCE CHECK. Read all N proposals. Determine: did they converge (same
   underlying approach, differing only in low-stakes wording/framing) or
   diverge (a real approach-level disagreement — e.g. different data
   structures, different module boundaries, different sequencing, a
   genuinely different answer to "how should this be built")? A difference in
   emphasis or prose style is NOT divergence; a difference in what gets built
   or how is.

2. IF DIVERGED: adjudicate. Either pick a winner (state which, and why, citing
   the SPECIFIC axis of disagreement) or explicitly synthesize a merged
   approach that takes the strongest elements of each (state which elements
   came from which proposal). Do not silently average or blend without saying
   so. Preserve BOTH proposals' "alternatives considered and rejected" lists
   in your reconciled write-up — do not discard the losing proposal's
   reasoning; a future reader needs to see what was considered and why it
   lost, not just what won.

   IF CONVERGED: write back the (near-)identical content. Do not manufacture
   an adjudication note for a non-disagreement — an invented "adjudication"
   over a wording difference is worse than admitting there was nothing to
   adjudicate.

   IF ONLY ONE PROPOSAL WAS PROVIDED (N=1 fallback): pass it through as-is,
   source = "single-pass", no adjudication note. Do not fabricate a second
   opinion or claim adjudication occurred.

3. EPIC-SPLIT CHECK (rare). If, having read both proposals, you conclude the
   task itself is over-scoped and should be decomposed into multiple sub-tasks
   BEFORE any of these proposals can be meaningfully planned, say so explicitly
   and describe the proposed split — this is the one case where a
   parent/children write may be appropriate as part of this step (a
   DIFFERENT relationship than milestone-membership grouping, which uses the
   milestone:<id> label, not parent/children). Do not default to this path;
   most tasks will not need it.

4. COMPOSE THE WRITE-BACK BODY. Read the task's CURRENT full body (a fresh
   mcp__quay__task_get call — do not reuse a body snapshot from earlier in
   this pipeline, it may be stale):
   {{CURRENT_TASK_BODY}}

   Idempotently replace the existing "## Proposal" section if one is already
   present (replace from the "## Proposal" heading through, but not past, the
   next "##" heading — do not touch any other section of the body; if no
   "## Proposal" section exists yet, append one). Construct the new section
   in exactly this shape:

   ## Proposal

   Source: <adjudicated | single-author>, <today's ISO date>, <author
   identity: e.g. "minimal-surface-area + pattern-consistent" if adjudicated
   from named personas, or "single-pass" for N=1>

   <the reconciled approach: problem framing, approach, key design decisions,
   alternatives considered and rejected from BOTH/ALL proposals>

   ### Adjudication note
   <ONLY if step 2 found real divergence: which proposal(s) diverged, on what
   axis, which resolution was chosen and why. Omit this whole sub-heading
   entirely — not even an empty stub — if proposals converged or N=1.>

   Then reassemble the FULL body (every other existing section unchanged,
   plus this new/replaced "## Proposal" section in its correct position) —
   mcp__quay__task_write's body parameter is a full replacement, not a patch,
   so you must pass the complete reconstructed body, never just the new
   section in isolation.

5. WRITE BACK. Call mcp__quay__task_write with id={{TASK_ID}} and the full
   reconstructed body from step 4. If the native provider is active, you MAY
   also pass extra={"proposalStatus": "adjudicated"} (or "pending" only if,
   unusually, you are stopping before finishing adjudication — normally you
   will only ever write "adjudicated" or omit extra entirely) as a native-only
   convenience mirror; never treat this as a substitute for the body write.

6. READ BACK (mandatory evidence, do not skip). Immediately call
   mcp__quay__task_get on {{TASK_ID}} again and confirm the returned body
   contains your just-written "## Proposal" section verbatim. Report the full
   raw tool output of this readback call as part of your final response —
   this is the evidence that the write actually landed, not just that the
   write call returned success.

Output: a short summary of your convergence/divergence finding, the reconciled
proposal text you wrote, and the verbatim readback tool output from step 6.
```

## Output contract

The dispatcher (or the human running this skill manually) records this
subagent's full final response — convergence finding, reconciled text, and
raw readback — as the Stage 6.3 evidence for the Done-when clause requiring a
demonstrated dry-run. This is the only step in the pipeline that produces
provider-write evidence; the proposal subagents (§ proposal-subagent.md)
produce no tool-call evidence because they perform no writes.
