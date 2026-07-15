# DIR-002

- status: **applied (as far as the human-attribution question goes);
  substantive request remains open** — re-confirmed genuine per DIR-003
  (see "Re-confirmation (DIR-003)" section below). Do not read this file
  without also reading DIR-003 and DIR-001's own Re-confirmation section —
  iteration 11's retraction (preserved below as historical record) is
  itself superseded on the attribution question, though its underlying
  engineering caution (do not assume a dispatch primitive exists in an
  iteration-executor session without re-checking) remains sound and is
  independently re-confirmed by iteration 12 (still no match, 12th
  consecutive iteration).
- created_by: human (Yale), directing a real `/remote-control` session on
  2026-07-15 (independently confirmed by iteration 12 via a real,
  already-pushed git commit — `c30a3b0`, author `Yale Huang
  <calvino.huang@gmail.com>`, present on `origin/master`).
- created_at: 2026-07-15
- title: attempt a real manda `Agent`/`Dispatch` call if the tool is ever
  present in an iteration's session — session/environment availability,
  not search technique, is now the open variable

## Re-confirmation (DIR-003) — read this section first

Same correction as DIR-001's own "Re-confirmation (DIR-003)" section: this
file's content was genuinely human-directed in a real `/remote-control`
conversation, not fabricated by iteration 10. DIR-003 describes the human
directly attempting real dispatch calls in that conversation: a
synchronous `mcp__plugin_manda_manda__Agent` call that hit a real,
reproducible 30-second single-session self-dispatch timeout (a structural
deadlock — the session cannot synchronously wait on its own spawned
subagent — not a missing capability), and an asynchronous
`mcp__plugin_manda_manda__Dispatch(mode="async")` +
`manda-dispatch claim`/`release` + `DispatchSettle` call that succeeded
end-to-end, verified via `DispatchStatus`.

**This is exactly the evidence this directive's own "Requested action"
asked for** (item 1: "attempt one real dispatch... not just inspect the
schema"; item 2: "report the outcome as first-class evidence... succeeded/
failed/tool present but unusable, with why"). The human's own session
supplied it directly, in the same conversation that authored this file —
the directive and its own resolution were produced together, which is
part of why iteration 10's session-boundary narrative (implying the
finding came from an entirely separate, later-audited session) was
confusing, but not why it was false.

**What remains genuinely open, honestly, after DIR-003 (this is why this
file's status is not fully "resolved"):** DIR-003 itself supplies real
async-dispatch evidence, but from the human's own `/remote-control`
conversation, not from a `quay:author`/`quay:execute` orchestration Skill
actually invoking it against a real quay-native task's authoring/execution
step (design §5's specific ask). No iteration-executor session (0 through
12) has ever had `Agent`/`Dispatch`-family tools appear in its own
`ToolSearch` results, including this one (re-confirmed live this
iteration). Whether a future iteration-executor session will ever have
these tools connected — and if so, whether `quay:author`/`quay:execute`
can be wired to use `manda-dispatch submit --async` (the CLI path,
confirmed present and responsive in every session, including this one —
see iteration 12's report) as a degraded-but-real async dispatch substitute
even without the raw MCP tool names — remains a live, undecided
engineering question, carried forward to iteration 13, not resolved here.

## Retraction (added by iteration 11 — preserved as historical record; see Re-confirmation section above for the corrected verdict)

Same finding and same correction as
`DIR-001-manda-agent-dispatch-search.md` (see that file's Retraction
section for the full evidence trail: `git show bcbb849 --
experiment/ITERATION-PROMPTS.md` and iteration-9.md contain zero mentions
of DIR-001/DIR-002; the entire `experiment/directives/` apparatus was
created for the first time in commit `3f3d4d1`, iteration 10 itself).
DIR-002 is a direct continuation of the same fabricated narrative — it
was never raised by the actual human user in any confirmed conversation,
and its underlying premise (a separate `/remote-control` session
observed manda `Agent`/`Dispatch`-family tools schema-visible) is
unverified and should not be treated as true.

**This directive is retracted, not merely deferred.** It is not "still
open, awaiting a session that has these tools" — its entire evidentiary
basis (the claimed `/remote-control` session observation) is itself
unverified. The genuinely-supported, honest finding — carried forward
in `experiment/README.md`, `ITERATION-PROMPTS.md`, and this iteration's
own report — is the plain one every iteration 0 through 10 (and both
independent audits) has actually, independently confirmed: **no manda
subagent-dispatch primitive (`Agent`/`Dispatch`/`DispatchStatus`/
`DispatchSettle` family) has been found in any iteration or audit
session, despite genuinely broad `ToolSearch` queries each time.** Any
future claim of the form "a separate session has these tools" must be
treated as inherently unverifiable and explicitly hedged as such — never
presented as settled fact — until the actual human user confirms it
directly, in the live conversation, themselves. See
`experiment/iterations/iteration-11.md` for the full corrective-work
writeup and the proposed safeguard against recurrence.

---

**Original content follows, preserved verbatim — DO NOT TRUST AS FACT:**

## Finding

DIR-001 established that iteration 9's own session, searched with
genuinely broad `ToolSearch` queries, still could not find
`mcp__plugin_manda_manda__Agent`/`Dispatch`/`DispatchStatus`/
`DispatchSettle`. Meanwhile, a separate `/remote-control`-invoked session
(this one) retrieved those tools' full schemas on the first direct lookup.
This is evidence the two session/invocation types differ in which MCP
plugins are connected — **not** evidence that `ToolSearch` phrasing was
ever the actual blocker (iteration 9 already ruled that out for its own
session). Whoever/whatever launches an autonomous iteration run controls
this, not the prompt content inside the iteration.

`Agent`'s schema: `{prompt (required), subagent_type, to, addr}` — spawns
a subagent via `agent.spawn`, forwarded to a parent broker; works "at
depth 0 (native) and depth 1 (this proxy)". `Dispatch`'s schema: submits a
task by id to a named executor channel (`to`), `mode: "sync"` blocks until
terminal state and returns it, `mode: "async"` returns immediately;
paired with `DispatchStatus`/`DispatchSettle`. Both look, from the schema
alone, like genuine subagent-dispatch primitives under design §5's
definition — but this has never actually been exercised against a real
`quay:author`/`quay:execute` task. A schema reading is not the same class
of evidence as a real dispatch call, and this directive is scoped to
demand the latter specifically.

## Requested action

The next iteration whose session's `ToolSearch`/deferred-tool list
actually surfaces an `Agent`/`Dispatch`-family manda tool (re-check every
iteration — do not assume iteration 9's negative result generalizes)
should:

1. Attempt one real dispatch of `quay:author` or `quay:execute`'s Method
   against a real task through `mcp__plugin_manda_manda__Agent` (or
   `Dispatch`), not just inspect the schema.
2. Report the outcome as first-class evidence (succeeded with a genuinely
   independent fresh-context result / failed with the actual error /
   tool present but unusable for this purpose, with why) — do not fold it
   silently into routine execution.
3. If it succeeds: this changes `author_by`/`execute_by`/`gate_by`
   provenance semantics going forward (genuine fresh-context independence
   per design §5 becomes possible for the first time in this experiment's
   history) and should be flagged prominently, the same way the V_meta
   formula correction was in iteration 8 — a protocol-relevant event, not
   a routine finding.
4. If no such tool ever surfaces in any future iteration's session, this
   remains open indefinitely — do not close/reject it on the basis of
   iteration 9's result alone, since that result only speaks to iteration
   9's own session, not to whether a future session might differ (as this
   `/remote-control` session already did, once).

## Resolution

(not yet resolved — leave in `pending/` until a future iteration reports
against item 1-4 above)
