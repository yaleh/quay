# DIR-001

- status: applied
- created_by: human (Yale), raised during a `/remote-control` session
  reviewing iterations 0-8
- created_at: 2026-07-15
- title: iterations 0-8's "no subagent-dispatch primitive" finding never
  actually searched for `mcp__plugin_manda_manda__Agent`/`Dispatch`

## Finding

Every iteration 0-8 concluded "no subagent-dispatch primitive exists in
this environment" (G6, degraded same-session fallback), but the actual
`ToolSearch` history only ever ruled out two things: `manda-dispatch`'s
submit/status/cancel/fork-join (iterations 0/1 — requires a separately
registered executor session, not spawnable from one tool-calling turn) and
`mcp__plugin_manda_manda__Send` (iteration 7 — a post-one-message-to-a-
channel primitive, no spawn, no reply). `mcp__plugin_manda_manda__Agent`
and `mcp__plugin_manda_manda__Dispatch`/`DispatchStatus`/`DispatchSettle`
never appeared in any iteration's `ToolSearch` results.

In a separate `/remote-control`-invoked session (this one), a direct
`ToolSearch` query (`select:mcp__plugin_manda_manda__Agent,...`) returned
full schemas immediately. `Agent`'s description: "Spawn a subagent...
forwarded to the parent broker via the agent.spawn capability so the same
prompt works at depth 0 (native) and depth 1 (this proxy)" — this is, on
its face, exactly the fresh-context independence primitive design §5
requires and every iteration 1-8 report says is missing. Whether this was
(a) present but missed by narrow `ToolSearch` query phrasing in iterations
0-8, or (b) genuinely absent from those sessions' tool lists, was not
determined at the time this directive was written — flagged as open, not
asserted either way.

## Requested action

Before repeating the standing "no dispatch primitive" finding, re-run
`ToolSearch` for a subagent-dispatch primitive with genuinely broad
queries (not just narrow "subagent dispatch spawn agent task delegate"
phrasing — also bare terms like "agent", "dispatch"). If any
`Agent`/`Dispatch`-family tool is found, attempt one real dispatch call
against a real task (not just inspect the schema) and report the outcome
as first-class evidence.

## Resolution

- resolved_by: iteration-9 (commit `bcbb849`)
- outcome: applied (partially — see DIR-002 for the still-open remainder)
- evidence: iteration-9 found this directive uncommitted on disk at
  iteration start (`experiment/iterations/iteration-9.md` §2), re-ran
  `ToolSearch` with genuinely broad, bare-word queries ("agent",
  "dispatch") in addition to the standing phrased query, and re-inspected
  `mcp__plugin_manda_manda__Send`'s schema directly. **Result: still no
  `Agent`/`Dispatch`-family match in that session** — only unrelated tools
  surfaced (`EnterWorktree`, `archguard_*`, etc.). This closes the "maybe
  it was just a query-phrasing miss" hypothesis for iteration 9's own
  session specifically: the broadened search is genuine, not a repeat of
  the narrow one. It does **not** close the broader question, because the
  tool *was* observed present (via direct `select:` lookup, not keyword
  search) in this separate `/remote-control` session — meaning the
  remaining open variable is most likely **which session/invocation type
  has the manda MCP plugin connected**, not search technique. That
  narrower, more precise open question is carried forward as DIR-002
  rather than closed here, since this directive's specific requested
  action (broaden the search) was genuinely carried out.
