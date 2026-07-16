---
status: pending
created_by: human (calvino.huang@gmail.com), asserted directly in this live conversation
created_at: 2026-07-16
title: manda nested-subagent depth-1 caller must never be a synchronous call from the same session that owns the target broker channel — corrects iteration-77's attribution
---

## Finding

Using meta-cc to cross-reference the quay-bootstrap-experiment orchestrator
session (`f0c763bc-9823-49e5-a3d4-7c818af450c5`, top-level PID 3176586)
against its own `mcp__plugin_manda_manda__*` tool calls, this conversation
reconstructed the exact timeline of the orchestrator's manda nested-subagent
activity around iteration 77 (2026-07-16, all times UTC):

| Time | Event |
|---|---|
| 11:19:59 | Orchestrator dispatches iteration 77 as a **background** subagent (per DIR-015) |
| 11:22:29 | Iteration 77, running in its own background execution, posts a cap-request to channel `cord`. The orchestrator's own top-level turn is free (iteration 77 runs elsewhere), catches the live notification, spawns a background leaf ("Iteration-77 manda trial leaf"), and... |
| 11:22:42 | ...calls `mcp__plugin_manda_manda__respond(id="18c2c14da8cd87e3", ...)` — succeeds, 21.6s round trip (iteration-77.md's own T_pre_call/T_post_call, 26.28s end-to-end from iteration 77's side, confirms no timeout) |
| 11:27:05 | The orchestrator itself calls `mcp__plugin_manda_manda__Agent(to="cord", timeout=90)` **directly, synchronously, in its own top-level turn** — not wrapped in a background subagent this time |
| 11:28:35 | That call times out: `MCP error -32603: timeout waiting for cap "agent.spawn" result after 1m30s: context deadline exceeded` — exactly 90s after 11:27:05 |
| 11:28:49 | Only *after* unblocking does the orchestrator spawn a background leaf agent, and... |
| 11:29:03 | ...call `respond(...)` — moot; the caller had already given up 28s earlier |

This yields two corrections to the experiment's own record:

1. **Iteration 77's trial actually succeeded and is now fully
   attributable.** `experiment/iterations/iteration-77.md` §5.1 recorded
   its own result as "inconclusive" solely because it (running as a
   background subagent with no visibility into the top-level orchestrator's
   transcript) could not identify who serviced its cap-request. The
   meta-cc cross-session trace above resolves this: the orchestrator
   session itself serviced it cleanly, well within timeout, via a
   background leaf spawn + prompt `respond()`. Iteration 77 undersold its
   own result for lack of cross-session visibility, not because the
   result was actually ambiguous.

2. **The subsequent 11:27-11:29 failure is a self-deadlock, not evidence
   of a manda/daemon-side defect.** The orchestrator called the depth-1
   `mcp__plugin_manda_manda__Agent` proxy synchronously from its own
   top-level turn, while that same session is also the bound broker
   (armed `manda monitor cord`) for the very channel (`cord`) it targeted.
   A synchronous tool call blocks that session's own turn processing, so
   it could not receive/act on its own incoming cap-request notification
   until the blocking call itself gave up at the deadline — by
   construction, this can never succeed regardless of daemon behavior.
   This is the **same failure class this project already diagnosed once
   before**, on 2026-07-15, in `DIR-002`/`DIR-003` (iterations 8-12):
   "the synchronous `Agent` call... structurally deadlocks when the same
   session is both [requester and responder]." The orchestrator's latest
   attempt re-triggered a previously-solved problem by omitting the
   background-dispatch precondition.

This is the precise, evidenced difference from every successful trial run
in the human's concurrent driving session (PID 3526382, see the archived
resolution this directive supersedes/refines: DIR-019). In all of those
trials, the depth-1 caller was always dispatched as a **separate
background subagent** (`run_in_background=true`) distinct from the
broker's own top-level turn — never a direct/blocking call issued by the
same session that also owns the target broker's monitor — so the broker
stayed free to catch and service the notification within the caller's
timeout window.

## Requested action

1. Correct `experiment/iterations/iteration-77.md`'s own record (via a
   dated resolution/addendum, not by rewriting the original report) to
   note that its manda trial is now confirmed attributable and successful,
   per the meta-cc cross-session evidence above.
2. Codify, as a hard rule for any future manda nested-subagent use in this
   experiment (iteration subagents, out-of-band audit subagents, and the
   orchestrator's own top-level turn alike): **the depth-1
   `mcp__plugin_manda_manda__Agent`/`Dispatch`/`request` caller must never
   be issued synchronously from the same session that owns the bound
   broker monitor for the target channel.** If the caller and the broker
   are the same session, the caller half must be dispatched as a separate
   background subagent (`run_in_background=true`) so the session's own
   top-level turn remains free to service the resulting cap-request. This
   generalizes DIR-002/DIR-003's original finding and should be added to
   `ITERATION-PROMPTS.md` or wherever this project's own G6/manda
   preconditions are codified, so it is checked mechanically rather than
   re-discovered by trial and error.
3. Given both correction (1) and the underlying mechanism are now cleanly
   understood, treat DIR-019's own open question ("broker-availability
   artifact vs. genuine daemon-side SSE bug") as **resolved in favor of
   (a), no evidence for a genuine daemon-side defect** — three independent
   clean successes now exist (two in the human's session, one newly
   attributed to the orchestrator's own iteration-77 trial), and the one
   failure since has a fully explained, non-daemon root cause (self-
   deadlock). DIR-019 may be archived once this directive's action 2 is
   applied.

<!-- ## Resolution: to be filled in by the iteration that applies this directive -->
