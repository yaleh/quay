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
4. Update `experiments/quay-native-bootstrap/directives/README.md`'s G6-framing discussion (or
   wherever the "no dispatch primitive found in 0-12" claim currently
   lives) to note this was a fixable process-startup defect, not a
   permanent environmental ceiling — this changes the honest long-term
   framing of that finding even before re-testing confirms current
   availability.

## Resolution

- status: applied
- resolved_by: top-level orchestrator session (this conversation, not a dispatched iteration-executor — the reconnected `manda mcp` gateway is scoped to this session, and no evidence exists that a freshly-`Agent`-dispatched iteration-executor subagent inherits it)
- resolved_at: 2026-07-15

**Found: YES, positively, for the first time across 13+ iterations.** `ToolSearch` in this session returned real, schema-loadable
`mcp__plugin_manda_manda__{Agent,Dispatch,DispatchStatus,DispatchSettle,DispatchCancel,DispatchProgress,TaskCreate,TaskGet,TaskUpdate,request,respond}`
tools — confirmed by successfully loading and calling several of them, not just seeing their names.

**Real end-to-end test performed (item 2), verbatim sequence:**
1. `Dispatch(id="dir004-probe-iter13", to="worker", mode="async", args={task, reply_to})` → `{"task_id":"dir004-probe-iter13"}`
2. `DispatchStatus(id="dir004-probe-iter13")` → `{"status":"queued"}`, both immediately and again after a real 20s sleep — no live session auto-claimed `pending-worker` in that window (several `manda monitor worker`/`cord`/`terminal` processes were running per `ps aux`, but none appears to have been actively watched/attended by an interactive Claude session at that moment; this is a "no reader currently attending" finding, not a tool/wiring failure).
3. `manda-dispatch claim --id=dir004-probe-iter13 --session=quay-orchestrator-probe --root .` → `claimed dir004-probe-iter13`; `DispatchStatus` → `{"status":"claimed"}`.
4. `DispatchSettle(id="dir004-probe-iter13", status="done", result={...})` → `{"relayed":true,"status":"done"}`.
5. `DispatchStatus(id="dir004-probe-iter13")` → `{"status":"done","kind":"done","payload":{"result":{...}}}` — terminal payload correctly folded in.
6. `manda-dispatch release --id=dir004-probe-iter13 --session=quay-orchestrator-probe` → `released dir004-probe-iter13` (note: this subcommand rejects `--root`, unlike `claim`/`status`/`submit` — a minor CLI-surface inconsistency, not a defect worth filing here).

**Verdict: found-and-works.** The submit → queue → claim → settle → status → release lifecycle is fully functional end-to-end via both the MCP tool surface and the `manda-dispatch` CLI, in this session, right now. The one caveat: automatic claiming by a live remote monitor session did not happen within the test window — full functionality was demonstrated by manually playing the executor role, not by a genuine second independent live session picking the task up unprompted. This is a materially real, positive result, but not the strongest possible form (a truly unattended cross-session pickup) — recorded honestly rather than overclaimed.

**Item 4 (README/G6 framing):** to be applied directly in `experiments/quay-native-bootstrap/directives/README.md` and iteration 13's report, per this finding — the "no dispatch primitive found in iterations 0-12" result stands as accurate for those specific sessions, but should now be framed as a fixed, session-scoped startup race (gateway started 42s before `.manda/config.yml` existed), not a structural or permanent capability gap. It remains an open question (not yet tested) whether a *newly dispatched* `baime:iteration-executor` subagent (via the native `Agent` tool) would itself inherit this reconnected gateway — the evidence here only establishes it for the top-level orchestrator's own long-running session.
