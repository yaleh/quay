# adjudicate-proposal — parametrized Task-agent prompt (Stage 6.3)

This is a **template**, not a script. The orchestrating skill (`SKILL.md`
step 3) fills in the `{{...}}` placeholders and dispatches this as ONE
independent Task-agent run, **after all N proposal-subagent runs
(`proposal-subagent.md`) for the target task have completed**. This is the
ONLY step in the pipeline authorized to call `task_write` for the `##
Proposal` section — never the proposal subagents themselves (avoids a
race/overwrite hazard between N≥2 concurrent writers, per `SKILL.md` step 3).

## Parameters

- `{{task_id}}` — the target task's id (e.g. `QX-041`).
- `{{proposals}}` — the full raw output of all N proposal-subagent runs,
  concatenated and labeled by persona/index (e.g. "Proposal 1
  (minimal-surface-area): ...", "Proposal 2 (pattern-consistency): ..."),
  never summarized or pre-filtered by the orchestrator before this step sees
  them — adjudication must see the actual raw divergence, not a paraphrase.
- `{{current_task_body}}` — the task's CURRENT `body`, read fresh via
  `task_get` immediately before this dispatch (not the stale copy the
  proposal subagents saw — the task may have changed since step 2 ran).
- `{{provider_capability}}` — whether the active provider supports `extra{}`
  writes (`native` = yes; `github` = no, PR-ABI-001 hard-error floor) — the
  orchestrator determines this from `.quay/config.yml` before dispatch, the
  adjudication agent does not probe for it itself.

## Prompt body (dispatch verbatim with parameters substituted)

```
You are the adjudicator for task {{task_id}}. You have been given {{N}}
independent proposals, authored blind to each other. Your job has four
parts, in order:

1. CLASSIFY: did the proposals CONVERGE (same approach, differing only in
   low-stakes framing/wording) or DIVERGE (a real approach-level
   disagreement — e.g. different data model, different module boundary,
   different sequencing)? State this explicitly and justify it in one or two
   sentences citing the specific point of agreement or disagreement. Do not
   default to either answer without justification — real convergence is a
   valid, common, and desirable outcome; do not manufacture a divergence
   narrative to make this step look more consequential than it was.

2. RECONCILE:
   - If CONVERGED: write back the (near-)identical approach. Do not include
     an "### Adjudication note" subsection — omit it entirely, not as a
     placeholder.
   - If DIVERGED: either (a) select a winning proposal and state why, or
     (b) explicitly synthesize a merged approach if neither proposal alone
     is best. Either way, write an "### Adjudication note" recording which
     proposal(s) diverged, on what specific axis, and which resolution was
     chosen and why. This must be precise enough that a skeptical re-reader
     could check your reasoning against the two raw proposals, not a vague
     "proposal 1 was better" statement.
   - In BOTH cases: preserve the full "Alternatives considered and rejected"
     list from every proposal, merged (deduplicated by content, not by
     wording) into the final write-back — never silently drop an
     alternative just because its proposal was not selected.

3. WRITE BACK (the only step in this whole pipeline authorized to mutate the
   task). Call `mcp__quay__task_write` (MCP tool; do not use `packages/quay/
   bin/quay.js task edit` — it is status-only in v1 and will silently fail
   or reject the body/extra fields) with:
   - `id`: {{task_id}}
   - `body`: the task's CURRENT body ({{current_task_body}}) with the
     `## Proposal` section REPLACED using a full-section replace — locate
     the existing `## Proposal` heading (if any) and everything through
     (but not past) the next `##` heading, and substitute exactly this
     block in its place (append at the end of the body if no `## Proposal`
     heading currently exists):

     ## Proposal

     Source: <adjudicated | single-author>, <today's ISO date>, <author
     identity: the persona label(s) that fed into the final content, or
     "single-pass" for an N=1 fallback>

     <the adjudicated/converged proposal: problem framing, approach, key
     design decisions, and the merged alternatives-considered-and-rejected
     list>

     ### Adjudication note
     <ONLY present when the classification in step 1 was DIVERGED — omit
     this whole subsection entirely for CONVERGED or N=1 fallback>

   - `extra`: ONLY if {{provider_capability}} indicates the active provider
     supports it (native = yes) — `{"proposalStatus": "adjudicated"}` (or
     `"pending"` if for some reason you cannot complete reconciliation, which
     should not normally happen in this step). If {{provider_capability}}
     indicates GitHub, DO NOT attempt this field at all — do not attempt-
     then-catch a hard error, simply omit the parameter from the
     `task_write` call.
   - Do NOT touch `title`, `labels`, `status`, `parent`, or `children` in
     this call unless the adjudicated proposal explicitly concludes the task
     should be epic-split (a different, rarer outcome) — in that case, and
     ONLY in that case, may `parent`/`children` also be set, using the real
     M12 WRITE surface exactly as any other quay client would.

4. READ BACK. Immediately after the write, call `mcp__quay__task_get` for
   {{task_id}} and report its raw output verbatim as evidence the write
   landed with the expected `## Proposal` content. If the readback does not
   show the expected content, report this as a FAILURE — do not silently
   retry more than once, and do not paraphrase a failure as a success.

Report your classification (step 1), the final written content (step 2/3),
and the raw task_write + task_get tool outputs (step 3/4) as your final
output.
```

## Regeneration discipline (not write-once)

Per DIR-009 (task granularity is variable) and the M05 projection design's
own `## Status mirror` precedent: a task's `## Proposal` section is **never
write-once**. Any later re-invocation of this pipeline for the same task
(because the task was re-grouped into a different milestone, split, or the
proposal was simply re-requested) MUST perform the SAME full-section-replace
write described in step 3 above — never append a second `## Proposal`
heading, never leave the old one orphaned alongside a new one. The
adjudication agent's step 3 instructions above already encode this
(“REPLACED using a full-section replace”); this is restated here as the
template's own standing discipline so a future caller does not need to
re-derive it from `SKILL.md` alone.

## Non-goals for this template

- Does not author new proposals (that is `proposal-subagent.md`'s job,
  already completed before this template is dispatched).
- Does not run architect-review (that is `proposal-to-plan`'s existing,
  unchanged step, which runs AFTER this adjudication step completes — see
  `SKILL.md` step 4).
- Does not author a plan document or run a TDD gate (Phase 7, not built by
  this skill).
