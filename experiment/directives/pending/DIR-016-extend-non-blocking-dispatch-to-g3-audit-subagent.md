# DIR-016

- **status:** pending
- **created_by:** human (Yale), asserted directly in this live conversation
- **created_at:** 2026-07-16
- **title:** Extend DIR-015's non-blocking-dispatch requirement to the G3 independent-audit subagent, not just the iteration-executing subagent

## Finding

This conversation's human directly observed the driving session (PID
3176586, pts/6) execute iteration 70 end-to-end: the iteration-executing
subagent was dispatched via `Agent(..., run_in_background=true)`
("Backgrounded agent... Waiting for 1 background agent to finish"),
exactly as DIR-015 action 1 requires, and completed cleanly with no
self-audit violation (contrast iteration 69). The driving session's own
narration confirmed the intended benefit directly: *"Per DIR-015's own
point, I'm now free while it runs rather than blocked."*

**But the very next dispatch in the same turn — the mandatory G3
out-of-band audit of iteration 70's own work — was made in the
foreground.** The human's transcript shows `Agent(Iteration 70
independent G3 audit)` with inline tool-use output streaming
synchronously in the same message block, not the
`Backgrounded agent (↓ to manage · ctrl+o to expand)` /
`✻ Waiting for 1 background agent to finish` pattern iteration 70's own
dispatch used one step earlier. This audit did complete (commit
`b799002`, "Iteration 70: independent G3 audit — PASS WITH CONCERNS"),
so nothing failed this time — but the driving session was, for the
audit's full duration, back in exactly the blocked state DIR-015 was
written to eliminate.

**This is the same class of gap DIR-015 itself closed for the iteration
dispatch, left open one call later.** DIR-015's own Finding cites DIR-011
directly: the manda `Agent`/cap-request round trip "only completes when
*both* requester and broker dispatch non-blockingly: a foreground-blocked
dispatch on either side produces a false timeout." That reasoning is not
specific to *which* subagent is being dispatched — it applies identically
to the audit-dispatch call. Leaving the audit dispatch foreground-blocked
means the driving session still cannot service a concurrent
`cap-requests-*` event (or do anything else useful) for the audit's
entire duration, undermining DIR-015 action 1's stated purpose for
roughly half of every iteration's total dispatch time (one iteration
dispatch + one audit dispatch per cycle).

## Requested action

1. Amend `experiment/ITERATION-PROMPTS.md`'s §0a (added by DIR-015 action
   1, immediately after the G6 operational check) so the non-blocking-
   dispatch requirement explicitly covers **every subagent the driving
   session dispatches as part of running an iteration — the
   iteration-executing subagent AND the §9 out-of-band G3 audit
   subagent** — not just the former. Quote this directive's Finding (the
   `Agent(Iteration 70 independent G3 audit)` foreground dispatch,
   immediately following a correctly-backgrounded iteration dispatch) as
   the concrete evidence the gap is real, not speculative, mirroring how
   DIR-015 itself cited DIR-011.
2. Extend DIR-015 action 2's mechanically-checkable orchestrator
   confirmation step (citing the actual dispatch call's
   `run_in_background` argument value) to apply separately to the audit
   dispatch, not only the iteration dispatch — since, per iteration 69/70's
   own established finding, an iteration-executing subagent cannot
   observe its own dispatch mode from inside its own context, and by the
   same logic an audit subagent cannot observe the orchestrator's dispatch
   mode either; this remains an orchestrator-scoped confirmation, to be
   recorded in the orchestrator's own record of the cycle, not inside
   either dispatched subagent's report.
3. Do **not** reopen DIR-012/DIR-015 action 3's settled scope decision
   about *which mechanism* performs the G3 audit dispatch (the native
   `Agent`/Task tool, unconditionally — manda nested-subagent dispatch
   remains out of bounds for the audit path). This directive is narrowly
   about *how* that same native dispatch call is invoked
   (`run_in_background=true` vs. the default synchronous mode), not about
   changing the mechanism itself.

## Resolution

<!-- Filled in by whichever iteration applies this directive. -->

## Progress note (added 2026-07-16, by the independent G3 audit of
iteration 71 — `experiment/audits/iteration-71-independent-adjudicate.md`)

This directive was committed (`34cba21`) as a direct git ancestor of
iteration 71's own commit (`03e5dc9`), only 112 seconds earlier on the same
linear branch — meaning it was present in `experiment/directives/pending/`
throughout iteration 71's run. Iteration 71's own precondition check
(`experiment/iterations/iteration-71.md` §2) nonetheless claimed this
directory was empty, and never mentioned this directive anywhere in its
report. Per `experiment/directives/README.md`'s "Lifecycle" §, a directive
must not "silently sit unchanged run after run" — this note records that
it did, for one full iteration cycle, and flags it explicitly so the next
iteration cannot repeat the same miss. **Still `status: pending` — the
next iteration must read this file in full and reach an explicit
applied/deferred/rejected outcome, recorded in its own report, per the
standard lifecycle.**
