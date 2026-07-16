---
status: pending
created_by: human (calvino.huang@gmail.com), asserted directly in this live conversation
created_at: 2026-07-16
title: Use the just-confirmed-viable method to verify and actually use manda nested subagent
---

## Finding

In this live conversation (driving session, PID 3526382), a 2-level manda
nested subagent round trip was executed end-to-end and **succeeded** for
the first time in the entire investigation, using background subagents at
both levels:

- Depth-1: native `Agent(run_in_background=true, ...)` calling
  `mcp__plugin_manda_manda__Agent(to="terminal", prompt="...", subagent_type="claude",
  timeout=90)`, deliberately **without** an `addr` override.
- The cap-request (`cap=agent.spawn`) arrived via the armed `manda-monitor
  terminal` live `<task-notification>` essentially instantly after depth-1
  dispatched.
- Depth-2: a native background `Agent(...)` leaf subagent was spawned
  immediately to service the request, completing in ~3.5s with the exact
  text `leaf alive`.
- `mcp__plugin_manda_manda__respond(id=<request-id>, result={"value":"leaf alive"})`
  was called immediately after, returning `{"ok":true}`.
- Depth-1 unblocked ~21.6s after its own start (T1=1784200148.979,
  T2=1784200170.579), returning `{"value":"leaf alive"}` — an exact match.

This succeeded where at least two earlier attempts in this same
conversation, using the *identical* mechanics (same daemon, same monitor,
same profile, no `addr` override), failed with the classic
`MCP error -32603: timeout waiting for cap "agent.spawn" result after 1m30s:
context deadline exceeded`. The determining difference, confirmed by
process/timing evidence, was **not** manda-side re-configuration — it was
that in the two failures, the broker session was not actively watching in
real time for the whole request window (once because of a compaction/pause
gap between dispatch and response, once because the monitor's live
notification simply never fired). In the successful trial, the broker
serviced the cap-request within seconds of receipt, with no gap.

Two preconditions were also independently confirmed necessary (established
earlier in the same conversation, root-caused against manda source):

1. **Address-freeze workaround**: the project's manda daemon must be
   started (and `.manda/hub.addr` written) *before* the Claude Code
   session/MCP plugin connects, since manda's MCP client subprocesses
   resolve and permanently cache the daemon address once at their own
   startup (`resolveAddr` in `manda-tools/main.go`, frozen into
   `internal/toolsmcp/server.go`'s `DaemonAddr` field). Starting the
   session before the daemon/`hub.addr` exist permanently freezes the MCP
   client onto the wrong fallback address (`http://localhost:7474`) for
   its entire process lifetime, regardless of later daemon restarts.
2. **Live-broker precondition**: a `manda-monitor <name>` must be armed
   (via `Monitor(command="manda monitor <name> --root .", persistent=true,
   ...)` — not just the skill's returned recipe text) in a session that
   remains actively turn-taking, so cap-request notifications are received
   and serviced within the caller's timeout window.

This is now a confirmed, reproducible, working method — not a hypothesis.

## Requested action

Direct the quay-bootstrap experiment (iteration subagents and/or the
driving session) to:

1. Adopt the two preconditions above as standard operating procedure for
   any manda nested-subagent usage in this project: daemon-before-session
   ordering, and an actively-watching live broker for the duration of any
   dispatch that depends on a cap-request round trip.
2. Re-run and record at least one additional live-broker trial to
   distinguish between the two remaining hypotheses for the prior
   failures: (a) broker-availability artifact only (no daemon-side bug),
   vs (b) a genuine daemon-side SSE fan-out bug (`internal/daemon`'s
   `handleStream`) that happens to also manifest under a missing broker.
   A second clean success under a verified-live broker would support (a)
   and let the "deeper SSE bug" hypothesis from DIR-017/prior iterations
   be closed as a false lead; a failure under a verified-live broker would
   instead confirm (b) and warrant filing that specific finding upstream
   in the `manda` project.
3. Where the experiment's own workflow has real uses for manda nested
   subagent dispatch (not just verification trials), use this confirmed
   method going forward rather than treating nested subagent dispatch as
   an open/unreliable capability.

<!-- ## Resolution: to be filled in by the iteration that applies this directive -->
