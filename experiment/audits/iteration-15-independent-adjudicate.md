# Iteration 15 — Independent Out-of-Band Audit (G3) — NOT OBTAINED

**Status: FAILED TO DISPATCH — no independent audit exists for iteration 15.**

This file exists so the absence of an `iteration-15-independent-
adjudicate.md` verdict is not mistaken for an oversight. Unlike
iterations 13 and 14 (both of which successfully obtained a genuine,
independently-dispatched mechanical `adjudicate` co-sign via
`mcp__plugin_manda_manda__Agent`), **iteration 15's own attempt to
dispatch an independent auditor failed**, for the same reason
documented in iteration 15's own report (§9, §3):

1. `mcp__plugin_manda_manda__Agent` was called with a full,
   detailed independent-auditor brief (verify backlog counts, re-run
   the `Agent` timeout test itself, recompute σ/V arithmetic, assess
   the convergence-criterion-5 reasoning, write a verdict to this
   file). The call **timed out**: `MCP error -32603: timeout waiting
   for cap "agent.spawn" result after 30s` (at `2026-07-15T09:56:03Z`
   UTC, per `date -u` at time of attempt).

2. A fallback via `mcp__plugin_manda_manda__Dispatch` (`pool: true`,
   the confirmed-live async task-queue per DIR-004/iteration 13) was
   then tried. The submission itself succeeded
   (`{"task_id":"iter15-audit-probe"}`), but no live worker session
   claimed the task within a reasonable window — the same "no live
   session is attentive" limitation iteration 14 diagnosed for
   `Agent`'s relay mechanism applies equally to the async queue when
   no claimer is watching. The task was explicitly cancelled via
   `DispatchCancel` (recorded reason: no live claimer available) rather
   than left orphaned or its eventual unbounded-future claim
   misrepresented as this iteration's audit.

**Consequence for the experiment's guardrails:** this is the first
iteration (of 13, 14, 15 — the iterations that have attempted this
practice) where the mechanical `adjudicate` co-sign itself could not be
obtained, not merely "obtained but pending escalation to human
sign-off." Convergence criterion 4 in `experiment/iterations/
iteration-15.md` §10 reads NO for this more specific reason. The
experiment's provenance/report both treat this honestly as a gap, not
as a silent substitute-with-self-check.

**Recommendation for the next iteration:** retry the independent-audit
dispatch. If it continues to fail across multiple iterations, this
becomes a standing risk to G3 compliance (protocol §6) that the
experiment's own process may need to explicitly address — e.g. by
identifying a specific window/precondition under which a live monitor
is confirmed attentive to the relay/pool channel before attempting the
audit dispatch, rather than attempting it opportunistically and
reporting failure after the fact each time.

See `experiment/iterations/iteration-15.md` §9 for the full narrative
and `experiment/provenance.md`'s "Records (as of end of iteration 15)"
section for the underlying task/σ state this audit would have checked.
