# DIR-016

- **status:** archived (resolved iteration 72 — see Resolution below)
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

- **resolved_by:** iteration 72
- **outcome:** applied (all 3 requested actions)
- **evidence:**
  - **Action 1 (amend §0a to cover both subagents, quote the Finding as
    concrete evidence, mirroring DIR-015's own DIR-011 citation) —
    applied.** `experiment/ITERATION-PROMPTS.md`'s §0a was retitled
    "Non-blocking dispatch — iteration-executing subagent AND the G3
    audit subagent" and restructured to state, in its opening
    Requirement paragraph, that BOTH dispatches are in scope, then to
    cite DIR-016's own Finding (the `Agent(Iteration 70 independent G3
    audit)` foreground dispatch, immediately following a
    correctly-backgrounded iteration dispatch) as a direct quotation,
    labeled "Load-bearing evidence for the extension to the G3 audit
    subagent (DIR-016's Finding, quoted verbatim)" — mirroring exactly
    how the pre-existing text already cited DIR-011's Finding for the
    original iteration-subagent scope. See `experiment/
    iterations/iteration-72.md` §5 for the full before/after and the
    verbatim text added.
  - **Action 2 (extend the orchestrator-only mechanically-checkable
    confirmation step to the audit dispatch separately) — applied.** The
    "Orchestrator-only confirmation step" paragraph in §0a now states the
    confirmation is checked and recorded **twice per cycle** (once per
    dispatch: iteration subagent, then separately the audit subagent),
    and the accompanying "Why this is orchestrator-scoped" paragraph was
    extended to state explicitly that an audit subagent, exactly like an
    iteration-executing subagent, cannot observe the orchestrator's own
    dispatch-mode choice from inside its own context — neither subagent's
    report may assert or self-certify its own dispatch mode; that
    confirmation belongs exclusively to the orchestrator's own record,
    for both dispatches. §0's own precondition checklist item was updated
    in the same edit to require both dispatches be confirmed, not just
    the iteration dispatch.
  - **Action 3 (do NOT reopen which mechanism performs the G3 audit
    dispatch) — explicitly honored, not merely skipped.** A closing
    paragraph, "Explicitly NOT reopened by this extension (DIR-016 action
    3)," was added to §0a stating in-place that this section governs
    dispatch *mode* only, and that the separate, already-settled question
    of *which mechanism* performs the G3 audit dispatch (the native
    `Agent`/Task tool, unconditionally, per DIR-012/DIR-015 action 3) is
    untouched and remains permanently out of bounds for manda
    nested-subagent dispatch. No edit was made anywhere to the §5
    OUT-OF-BAND AUDIT section's RETIRED/Historical-record text governing
    *which mechanism* is used — only §0a (dispatch *mode*) was touched.
    `experiment/iterations/iteration-72.md` §5 states this explicitly as
    a boundary respected, not merely a boundary not mentioned.
- **No V-factor movement claimed.** This is protocol/directive-application
  work on `experiment/ITERATION-PROMPTS.md` itself (amending existing
  prose), exactly like the precedent iterations 65, 67, 68, 70, 71
  established for their own directive/documentation-maintenance work —
  see `experiment/iterations/iteration-72.md` §7/§8 for the full
  factor-by-factor check (all 8 factors examined against §5.1/§5.2's
  exact defining language and found genuinely inapplicable, not
  defaulted-to-zero without checking).
- **No self-audit performed.** This iteration created no file with
  "audit" or "adjudicate" in its name. The independent G3 audit of this
  iteration's own work is, per standing discipline, exclusively the
  top-level orchestrator's separate job, performed afterward via a
  freshly-dispatched subagent with zero shared context with this
  iteration's work.
- **Resolves the "Progress note" below**: iteration 71's miss of this
  directive (recorded in the Progress note, the 15th post-hoc correction)
  is now closed — this directive has reached an explicit `applied`
  outcome, is archived (not left silently pending), and
  `experiment/directives/pending/` was re-verified empty of DIR-016 by
  `git mv` immediately before this Resolution was written.

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
