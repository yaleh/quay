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

## Progress note (iteration 77, 2026-07-16) — partial, honest, left PENDING

**What was checked, independently, by this session (not assumed from the
Finding above)**: iteration 77 could not verify the prior claimed success
(this Finding's own narrative) from repo artifacts alone — no committed
log/transcript exists beyond this directive's own text, which is a claim,
not independent evidence. Iteration 77's report
(`experiments/quay-native-bootstrap/iterations/iteration-77.md`, §3) states this explicitly and
does not repeat the narrative as established fact.

**What iteration 77 actually did**: ran its own fresh trial from its own
execution context (an iteration-executing session dispatched as a
background subagent, not an interactive top-level session). Found a
structural gap first: this execution context has **no native `Agent`/Task
subagent-spawn tool at all** — only manda's own `mcp__plugin_manda_manda__Agent`
proxy and `TaskStop` (shell-task control only). This means iteration 77
could not construct this Finding's exact described mechanism (native
depth-1 `Agent()` calling manda, serviced by a native depth-2 `Agent()`
leaf) — there is no tool available to spawn either half natively from
inside this execution context.

Given that constraint, iteration 77 instead issued one real, direct
`mcp__plugin_manda_manda__Agent(to="cord", ...)` cap-request itself (a
genuine `agent.spawn` post to the live, G6-confirmed daemon for this
session, `.manda/hub.addr` → `http://localhost:46215`, `cwd=/home/yale/
work/quay`). Verbatim: request posted at T=1784200941.309 UTC, result
`{"value":"leaf alive"}` returned at T=1784200967.593 UTC — **26.28s**, no
timeout, matching request id confirmed via `manda events cap-requests-cord`
/ `cap-results` cross-reference (see iteration-77.md §5 for full verbatim
output). This did **not** reproduce the DIR-011/012/014/017 timeout
signature.

**Why this is NOT recorded as a full "second clean success" and DIR-019
stays pending rather than moving to archive**: iteration 77 could not
conclusively attribute *who or what* serviced the cap-request. No new
subprocess appeared in `ps` around the request window; two independent
`manda monitor cord` processes exist on the host (one under this session's
own tree, one under an unrelated, idle session PID 1179383 showing no CPU
activity in that window); the actual responder is most plausibly this
session's own top-level context reacting to the `cord` monitor's rendered
notification, but that is **not verifiable from inside the tool-execution
context this iteration ran in** (no visibility into the top-level
session's own transcript/notification queue from a Bash/MCP subagent
call). Per this iteration's own explicit standing instruction, an
ambiguous-but-successful-looking result is not rounded up to "success."

**Net effect on the two competing hypotheses (broker-availability artifact
vs. genuine daemon-side SSE bug)**: no timeout occurred and a real result
was delivered under a live, G6-qualifying broker — this is evidence
*against* an unconditional daemon-side SSE fan-out defect and consistent
with hypothesis (a), but iteration 77 stops short of fully closing
hypothesis (b), since full attribution of the responder remains
unresolved. No finding is filed upstream against manda's own codebase, since
no failure was observed (the task instruction to file upstream applies only
on a live-broker failure, which did not occur here).

**Preconditions adopted as SOP, with an honest scope caveat**: both stated
preconditions (daemon-before-session address-freeze ordering; an
actively-watching live broker for the request's duration) are adopted as
project SOP for any future manda nested-subagent use in this project.
Precondition (a) was independently confirmed to hold for this session's own
manda MCP client by timestamp comparison (daemon + `.manda/hub.addr`
predate this session's own manda-plugin client by several minutes).
Precondition (b) (G6, an actively-watching broker) was independently
confirmed via the DIR-005/DIR-014 mechanized `ps` procedure — see
iteration-77.md §2. However, adopting precondition (a) as an *action* an
iteration-executor session can itself perform is only partially
actionable: a background-subagent-style execution context does not control
the ordering of its own manda-plugin-client startup relative to the
daemon/`hub.addr` (that ordering is fixed at Claude-Code-session/plugin-
load time, outside any subagent's own tool-call scope) — this iteration
could only *verify* the ordering after the fact, not *enforce* it.
Interactive top-level sessions retain more control here than
iteration-executor subagent contexts do.

**What remains**: a fully attributable "second clean success" (or a
definitive failure) requires either (a) a future iteration run with
genuine interactive, foreground, top-level session tool access (a native
`Agent`/Task tool, not a background-subagent dispatch), or (b) some other
mechanism for this execution context to positively confirm which process
served a given cap-request (e.g., an explicit marker in the depth-2
responder's own reply distinguishing it from any other live broker).
Left `pending`, not moved to `archive/`, since neither the SOP-adoption
action item nor the live-broker-trial action item is fully and cleanly
discharged by this iteration.

## Resolution

- **resolved_by:** iteration 78 (applying DIR-020's actions 1-3, which
  concern this same underlying finding)
- **outcome:** applied — archived with the open question resolved in
  favor of hypothesis (a) (broker-availability artifact only, no evidence
  of a genuine daemon-side defect), on a **corrected** evidence count,
  not the exact count DIR-020 itself proposed
- **evidence:** `experiments/quay-native-bootstrap/iterations/iteration-78.md` §5/§8;
  `experiments/quay-native-bootstrap/iterations/iteration-77.md`'s Addendum (added by iteration
  78); `experiments/quay-native-bootstrap/directives/archive/DIR-020-self-deadlock-in-manda-
  agent-synchronous-same-session-caller-broker.md`'s own Resolution

**Action 2 (re-run/distinguish the two hypotheses) — resolved, with an
honest correction to DIR-020's own count**: DIR-020 proposed resolving
this in favor of (a) on the claim of "three independent clean
successes... two in the human's session, one newly attributed to the
orchestrator's own iteration-77 trial." Iteration 78 re-examined this
claim directly against this file's own Finding text (the sole source for
the "human's session" evidence) and found DIR-020 **overcounts by one**:
this file's Finding describes exactly **one** successful round trip in
the human's driving session (PID 3526382; T1=1784200148.979,
T2=1784200170.579, ~21.6s, `leaf alive` exact match), preceded by **two
failures** in that same session (both explained by the broker not
actively watching in real time, not by daemon misbehavior) — not two
successes. No other repo artifact (`experiments/quay-native-bootstrap/iterations/`,
`experiments/quay-native-bootstrap/directives/`) records a second success from PID 3526382.

The corrected count is: **two** independent clean successes exist (one in
the human's session, per this file's own Finding; one now attributed to
the orchestrator's own iteration-77 trial, per DIR-020's cross-session
reconstruction — see `experiments/quay-native-bootstrap/iterations/iteration-77.md`'s Addendum),
plus **three** explained failures with non-daemon-defect root causes (two
broker-unavailability failures in the human's own session, documented in
this file's own Finding; one self-deadlock failure in the orchestrator's
11:27-11:29 UTC attempt, per DIR-020). This corrected count still
supports resolving in favor of hypothesis (a) over (b): every genuine
failure on record now has a specific, non-daemon explanation (broker not
watching, or a structural same-session deadlock), and every trial run
under a verified-live, actually-watching broker has succeeded without
reproducing the `MCP error -32603` SSE-timeout signature. This is a
narrower, more defensible basis for closing (b) than DIR-020's own
overcounted framing, but it reaches the same directional conclusion —
iteration 78 is making this call on its own re-examination of the
evidence chain, not by deference to DIR-020's exact count.

**Action 1 (adopt the two preconditions as SOP)**: already adopted, with
the honest scope caveat iteration 77 itself recorded (a background-
subagent execution context cannot enforce daemon-before-session ordering,
only verify it after the fact) — unchanged by this resolution.

**Action 3 (use the confirmed method for real workflow needs)**: remains
conditional guidance under `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §0b, per its
own standing caveats (reliability must be demonstrated per use, never
silently load-bearing for G3). No real production/workflow need for
nested-subagent capability-borrowing has arisen in this experiment since
iteration 77; this action item is not force-exercised here.

**Hard rule now codified going forward (via DIR-020, applied
simultaneously)**: `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §0b now contains a
mechanically-checkable rule — a manda depth-1 caller must never be issued
synchronously from the same session that owns the target channel's bound
broker — closing the specific mechanism that produced the one
self-deadlock failure in this evidence chain. See DIR-020's own
Resolution for the full text and precedent citation.
