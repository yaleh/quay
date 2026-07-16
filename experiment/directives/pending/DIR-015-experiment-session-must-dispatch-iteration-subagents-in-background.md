# DIR-015

- **status:** pending
- **created_by:** human (Yale), asserted directly in this live conversation
- **created_at:** 2026-07-16
- **title:** Require the experiment session to dispatch iteration-executing subagents in the background, not foreground

## Finding

This conversation's human observed, from directly watching the
experiment's driving session (PID 3176586, pts/6 — the same session
DIR-014 confirmed now has a live `manda monitor quay-bootstrap --root .`
bound to it, per `experiment/directives/archive/DIR-014-*.md` part (b)):
**that session dispatches the subagent that executes each experiment
iteration in the foreground** (i.e. the top-level orchestrator blocks,
synchronously waiting on the iteration-executing subagent's `Agent`/Task
call, rather than dispatching it with `run_in_background=true`).

This is a standing blocker for DIR-012's action 3 / DIR-014's action 3
(re-testing the manda nested-subagent mechanism for G3 audits), for the
same reason this session's own earlier, already-completed live
experiment established: `experiment/directives/archive/
DIR-011-manda-agent-live-verified-tool-name-latency.md`'s Finding
explicitly recorded, as a precondition for the manda `Agent`/cap-request
round trip to succeed at all, that **both the requester (the subagent
issuing the cap-request) and the broker (the session servicing it) must
dispatch non-blockingly** — the original test scenario that motivated
DIR-011 failed the first time specifically because a foreground-blocked
dispatch on one side produced a false timeout, and only succeeded once
both sides used `run_in_background=true`. A driving session that
dispatches its own iteration-executing subagent in the foreground cannot,
by construction, *also* be a live, responsive broker for a nested
manda cap-request originating from inside that same subagent — the
top-level session is synchronously blocked waiting on the subagent for
the iteration's entire duration, so it cannot service `cap-requests-*`
concurrently, regardless of whether a `manda monitor` process is bound
to it (DIR-014's fix) or not. DIR-014's action 1-2 fixed the *monitor
attachment* precondition; this directive addresses a **separate,
independently necessary** precondition — non-blocking dispatch — that
was not part of DIR-014's scope and has not yet been checked or fixed.

## Requested action

1. Amend `experiment/ITERATION-PROMPTS.md` (the same §0 preconditions
   section DIR-014 action 1 just amended, or an adjacent section if a
   future iteration judges that more appropriate) to require that
   whichever subagent executes a given iteration's work be dispatched
   **non-blockingly** (`run_in_background=true` for the platform's
   native `Agent`/Task tool, or manda's own non-blocking dispatch mode if
   the iteration itself is driven via manda) — not dispatched in the
   foreground/synchronous mode. Cite DIR-011's Finding directly as the
   evidence this precondition is load-bearing, not speculative.
2. Add a mechanically checkable confirmation step alongside DIR-014's
   amended G6 check: after dispatching the iteration-executing subagent,
   the driving session must confirm it is not itself blocked (e.g. by
   confirming it can still respond to a concurrent probe, or by citing
   the actual dispatch call's `run_in_background` argument value in the
   iteration report) — a verifiable claim, not an assertion, per this
   experiment's standing evidence discipline (G1, G3).
3. Once actions 1-2 are in place and DIR-014's own action 3 precondition
   (manda monitor bound for 2+ consecutive iterations) is also
   independently satisfied, re-attempt the manda nested-subagent audit
   test with **both** preconditions now met simultaneously — a session
   with a bound monitor that is *also* foreground-blocked on its own
   iteration subagent would still fail the test for the reason explained
   in the Finding above, so both fixes are necessary together, and
   neither alone is sufficient. Record explicitly, in whichever
   iteration attempts this, which of DIR-012/DIR-014's and this
   directive's preconditions were checked and how.
4. If, after both preconditions are genuinely met, the manda
   nested-subagent mechanism still fails for audit dispatch, record that
   as a new, narrower finding — per DIR-014's own action 4 reasoning,
   this would indicate a deeper problem, not a missing precondition, and
   should not be silently re-deferred with recycled reasoning.

## Resolution

<!-- Filled in by whichever iteration applies this directive. -->
