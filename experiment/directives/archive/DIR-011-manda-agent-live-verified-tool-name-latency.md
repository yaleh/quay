# DIR-011

- status: pending
- created_by: human (Yale), asserted directly in this live conversation
- created_at: 2026-07-15
- title: Live-verified manda `Agent` cap-request primitive works end-to-end; tool-name mismatch was the dominant latency/timeout driver, not a broken primitive

## Finding

In a live conversation (this session), a `manda-monitor` was armed via
`manda monitor terminal --root .` (skill `manda:manda-monitor`), giving this
session a broker identity `terminal` bound to daemon `http://localhost:28912`.
With that broker live and actively servicing `cap-requests-terminal` in
background (non-blocking, `run_in_background=true`) mode on both the
requester subagent side and the broker (this session) side, the real
`mcp__plugin_manda_manda__Agent` tool — **not** the bare `mcp__manda__Agent`
name used in `parent-injection-preamble.md` and in prior directive language —
was invoked successfully at depth-1, depth-1→depth-2, and
depth-1→depth-2→depth-3 nesting. All three completed with correctly
round-tripped results, including a bare-string `result` value being
correctly wrapped to `{"value":...}` by the depth-1-side MCP client
(consistent with the TASK-49 fix the user described from a prior session).

A controlled timing experiment isolated where the latency actually goes.
Cold (no tool-name hint) single-hop round trip: **103.2s** wall-clock, of
which **64.4s (62%)** was the calling subagent's own tool-discovery overhead
*before it even issued the call* — it had to run `ToolSearch` to find
`mcp__plugin_manda_manda__Agent` since the bare `mcp__manda__Agent` name was
not in its callable tool list. Monitor push (server-append timestamp,
decoded from the cap-request `id`'s embedded nanosecond epoch, to this
session's notification-receipt timestamp) was consistently small — **~3.2s
and ~3.3s across two independent runs** — confirming push delivery is NOT a
bottleneck. Hinting the correct tool name directly in the subagent's prompt
cut the same round trip to **21.6s (a 79% reduction)**, with the remainder
dominated by the mandatory `ToolSearch(select:...)` schema-load step (a hard
platform requirement for deferred tools, not avoidable) plus per-hop
`Agent()`-dispatch overhead.

Separately, a first 3-level attempt failed (the outer depth-1 cap-request
timed out at 120s). Decoding the cap-request `id` fields as embedded
timestamps showed the ~120s gap occurred *before* the nested cap-request even
reached the server — i.e. it was not a broker/Monitor responsiveness
problem, and is consistent with the same per-hop tool-discovery overhead
compounding across levels once the fix above is applied.

This directly bears on `README.md`'s recorded iteration-14/15 findings
("`Agent` timeout... not a locally-completing call... none of them visibly
picked up and answered the `cap-requests-*` relay within the 30s window").
Those tests used a 30s window and, per the same README text, no confirmation
is recorded that a live broker was actively watching and servicing the
channel in non-blocking mode on both sides at the time. This session's
results show the primitive itself completes reliably under those two
conditions (live broker + tool-name hinted), so the standing "primitive does
not complete" framing should be treated as unconfirmed under corrected
conditions, not a settled capability gap.

## Requested action

1. Update `parent-injection-preamble.md` (and any iteration-prompt text that
   constructs a capability-borrowing subagent's preamble) to name the real,
   currently-callable tool `mcp__plugin_manda_manda__Agent` instead of the
   bare `mcp__manda__Agent` alias, and to instruct the subagent to use a
   direct, minimal `ToolSearch(query:"select:Agent")`-style lookup rather
   than open-ended exploration — the discovery step is mandatory (the tool
   is deferred) but can be made cheap.
2. Before any future iteration records an "`Agent` primitive timeout" or "no
   subagent-dispatch primitive found" finding (the pattern in the
   iteration-14/15 `README.md` updates), it must first mechanically confirm:
   (a) a live `manda-monitor`-armed broker session is actively watching the
   relevant `cap-requests-<name>` channel in background/non-blocking mode on
   both requester and broker sides, and (b) the requester's injected
   preamble names the real tool per action 1. Only if the primitive still
   fails under those controlled conditions should it be recorded as a
   capability gap.
3. When planning any multi-level (depth ≥ 2) `agent.spawn` chain, budget
   per-hop latency in the ~21s (tool name hinted) to ~103s (cold discovery)
   range measured here, not a fixed small constant — a depth-3 chain without
   hinting can plausibly consume an entire 120s single-hop timeout budget on
   just its first two hops. Consider whether the `agent.spawn` cap timeout
   needs to scale with expected chain depth.

## Resolution
<!-- filled in by whichever iteration applies this directive -->
