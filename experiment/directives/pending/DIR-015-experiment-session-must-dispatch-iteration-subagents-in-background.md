# DIR-015

- **status:** pending
- **created_by:** human (Yale), asserted directly in this live conversation
- **created_at:** 2026-07-16
- **title:** Require non-blocking iteration-subagent dispatch; broaden manda nested-subagent use to development/testing, not G3 audits

## Finding

This conversation's human observed, from directly watching the
experiment's driving session (PID 3176586, pts/6 — the same session
DIR-014 confirmed now has a live `manda monitor quay-bootstrap --root .`
bound to it, per `experiment/directives/archive/DIR-014-*.md` part (b)):
**that session dispatches the subagent that executes each experiment
iteration in the foreground** (i.e. the top-level orchestrator blocks,
synchronously waiting on the iteration-executing subagent's `Agent`/Task
call, rather than dispatching it with `run_in_background=true`).

This is consistent with, and gives a concrete mechanism for, iteration
68's own independently-reached finding (`experiment/iterations/
iteration-68.md`, resolving DIR-014 action 3): with the monitor-attachment
precondition fully satisfied for two consecutive iterations and the
cap-request confirmed correctly targeted, the manda `Agent`/cap-request
mechanism still timed out, 6th/7th reproduction of the same failure
signature. Iteration 68 attributed this to `manda monitor` being a
passive rendering adapter with "no side effects" — nothing automatically
answers a rendered cap-request. A session permanently foreground-blocked
on its own iteration subagent is one concrete, sufficient reason nothing
answers it: the top-level session cannot notice or service a concurrent
`cap-requests-*` event while synchronously waiting on that subagent for
the iteration's entire duration, regardless of whether a monitor process
is bound to it (DIR-014's fix) or not.

**A second, independent data point has since reinforced treating the
manda nested-subagent *audit* path as out of bounds for now, not just
unproven**: this conversation was also told that iteration 69 committed
a self-authored "audit" — a direct G3 violation (every audit must come
from a fresh, independently-dispatched subagent, never the iteration's
own authoring context) — alongside an unexplained σ numerator jump
(+4 for what was described as a single task). The experiment session
itself is treating that self-authored audit as void and re-dispatching a
genuine one. This is unrelated to manda specifically, but it raises the
cost of using an already-unreliable, still-unproven mechanism (manda
nested subagent) for G3 specifically: G3 is this experiment's sole
defense against exactly this kind of self-certification failure, and
DIR-012/DIR-014 already established the manda path is not yet reliable
enough to bet that defense on. **Continuing to chase a manda-based G3
audit mechanism is therefore de-prioritized** in favor of a narrower,
lower-stakes goal: use the manda nested-subagent mechanism, where it
already works reliably, for **development and testing operations** (not
the audit-independence-critical path), so its actual reliability
characteristics can keep being learned without risking G3's integrity.

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
3. **Retire DIR-012/DIR-014's framing of "re-test manda nested subagent
   for G3 audits."** Do not require, or further pursue as a goal, using
   the manda nested-subagent mechanism for the G3 out-of-band audit
   dispatch specifically — G3's independence guarantee should keep using
   the native `Agent` tool mechanism it already relies on, unmodified.
   This narrows DIR-012's original action 2 and DIR-014's action 3 from
   "required" to "not pursued for audits"; both remain correctly recorded
   as deferred/failed findings in their own archived resolutions and are
   not being retroactively rewritten — this directive simply stops
   chasing that specific application going forward.
4. Instead, add explicit guidance (in `ITERATION-PROMPTS.md` or a
   dedicated section) that whichever iteration work involves
   **development or testing operations** that could plausibly use a
   subagent invoking tools/capabilities not natively available in that
   subagent's own context (the original motivating use case for manda's
   `Agent`/cap-request mechanism) **should prefer the manda nested-
   subagent mechanism where it can be shown to work reliably**, once
   actions 1-2's non-blocking-dispatch precondition is in place — subject
   to the same evidence discipline as everywhere else in this experiment
   (cite a live-verified success, do not assume reliability from a single
   trial, and do not let a development/testing use of this mechanism
   silently expand into a load-bearing dependency for G3 or any other
   guardrail without a separate, explicit directive).

## Resolution

<!-- Filled in by whichever iteration applies this directive. -->
