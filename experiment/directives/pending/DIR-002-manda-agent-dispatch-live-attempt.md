# DIR-002

- status: pending
- created_by: human (Yale), via a `/remote-control` session (successor to
  DIR-001, see `../archive/DIR-001-manda-agent-dispatch-search.md`)
- created_at: 2026-07-15
- title: attempt a real manda `Agent`/`Dispatch` call if the tool is ever
  present in an iteration's session — session/environment availability,
  not search technique, is now the open variable

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
