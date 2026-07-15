# DIR-004

- status: pending
- created_by: human (Yale), asserted directly in this live conversation
- created_at: 2026-07-15
- title: Root cause of the 12-iteration "no Agent/Dispatch tool" finding identified and fixed — re-run ToolSearch before trusting DIR-001/DIR-002's negative result further

## Finding

DIR-001/DIR-002 (archived) documented that no iteration (0 through 12)
ever found `mcp__plugin_manda_manda__Agent`/`Dispatch`/`DispatchStatus`/
`DispatchSettle` via `ToolSearch` in the iteration-executor session. That
observation was accurate, but its cause was misdiagnosed as an inherent
session-type/capability difference. The actual root cause, found by
inspecting live process state on the host (`ps`, `/proc/<pid>/cwd`,
`ps --ppid`) from the human's own `/remote-control` session:

The iteration-executor session's `manda mcp` gateway process (per
`manda/plugin/.mcp.json`, this single gateway is supposed to spawn
`manda-dispatch mcp` and `manda-tools mcp` as child subprocesses,
aggregating their tools — including `Agent`/`Dispatch*` — into one merged
surface, per `mcp_adapters` in `.manda/config.yml`) started at
`03:32:35`, **42 seconds before** `.manda/config.yml` was created
(`03:33:17`, auto-inited by the `manda monitor cord` skill invocation
that ran shortly after). The gateway read `mcp_adapters` at startup, found
no config file yet, and came up with **zero adapters** — confirmed via
`ps --ppid <that gateway's pid>` returning no children at all. The
gateway does not hot-reload config, so this defect was permanent for the
life of that process: every iteration from 0 through 12 ran inside a
session whose `manda mcp` connection genuinely had no `Agent`/`Dispatch`
tools to find — the negative `ToolSearch` results were truthful, not a
search-technique failure, but the underlying cause was a one-time startup
race, not a structural session-type limitation.

The human has since manually reconnected/restarted the `manda` MCP server
inside the live iteration-executor session (observable on the host: the
original gateway process is gone; a new `manda mcp` process is now
running as a child of that same session, itself now the parent of live
`manda-dispatch mcp` and `manda-tools mcp` child processes — the
aggregation working as designed, because `.manda/config.yml` already
existed by the time this new gateway started). The human confirms
`Agent`-family tools are now visible in that session.

## Requested action

1. In the next iteration that runs after this reconnection, re-run
   `ToolSearch` (or inspect the deferred-tools list) for `Agent`/
   `Dispatch`-family manda tools **before** repeating the now-13-times-
   made "not found" conclusion. If found, this closes the long-standing
   G6/DIR-001/DIR-002 open question with a positive result for the first
   time.
2. If found, attempt one real, minimal `Dispatch(mode="async")` (not
   the synchronous `Agent` call — DIR-002/DIR-003 already established
   that mode structurally deadlocks when the same session is both
   requester and fulfiller) end-to-end: submit, claim via
   `manda-dispatch claim`, execute a trivial task, `DispatchSettle`,
   verify via `DispatchStatus`, `manda-dispatch release`. This mirrors
   exactly what was already done once, successfully, in the human's
   `/remote-control` session (see DIR-002's archived resolution).
3. Record the outcome plainly either way (found-and-works,
   found-but-fails, or still-not-found) — do not assume success before
   testing, and do not re-litigate DIR-001/002/003's authenticity, which
   is already resolved.
4. Update `experiment/directives/README.md`'s G6-framing discussion (or
   wherever the "no dispatch primitive found in 0-12" claim currently
   lives) to note this was a fixable process-startup defect, not a
   permanent environmental ceiling — this changes the honest long-term
   framing of that finding even before re-testing confirms current
   availability.

## Resolution
(to be filled in by whichever iteration applies this)
