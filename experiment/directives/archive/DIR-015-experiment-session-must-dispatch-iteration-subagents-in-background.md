# DIR-015

- **status:** archived (resolved iteration 70 — see Resolution below)
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

Resolved at iteration 70. All four requested actions applied to
`experiment/ITERATION-PROMPTS.md`.

**(a) Action 1 — applied.** Added a new `§0a. Non-blocking iteration-
subagent dispatch` section immediately after the G6 operational check
(added by DIR-014), and a corresponding new checklist item in `§0`'s
preconditions list. It states the non-blocking-dispatch requirement
(`run_in_background=true` for the platform's native `Agent`/Task tool, or
manda's own non-blocking mode) and quotes DIR-011's Finding verbatim as
the load-bearing evidence: the manda `Agent`/cap-request round trip only
completes when both requester and broker dispatch non-blockingly: a
foreground-blocked dispatch on either side produces a false timeout. This
gives a concrete, sufficient explanation for iteration 68's own
independently-reached "6th/7th reproduction of the same failure
signature" finding, without requiring this iteration to re-litigate that
finding.

**(b) Action 2 — applied.** Added the mechanically-checkable orchestrator
confirmation step within the same `§0a` section, explicit that it is
**orchestrator-scoped, not subagent-scoped**: the iteration-executing
subagent cannot observe its own dispatch mode from inside its own
context (iteration 69 already established this directly, when deferring
DIR-015's application for exactly this reason — quoted and cross-linked
in the new section). The orchestrator must cite the actual
`run_in_background` argument value used and/or demonstrate it remained
responsive to a concurrent probe while the subagent ran.

This iteration (70) is itself being dispatched non-blockingly for the
first time, as a direct test of this action — see the "Dispatch-mode
observation for this iteration" note below for what could and could not
be confirmed from inside this executing subagent's own context.

**(c) Action 3 — applied.** Amended `§5. OUT-OF-BAND AUDIT` in the
"Iterations 1..k" template: the prior `DEFERRED (DIR-012 action 2)` framing
is now explicitly superseded by a `RETIRED, not merely deferred (DIR-015
action 3)` paragraph, stating plainly that the native `Agent`-tool
mechanism is the **permanent, unmodified** G3 audit-dispatch mechanism
going forward, and that pursuing manda nested-subagent dispatch for this
specific purpose is retired, not awaiting some future precondition fix.
The full historical DIR-012/DIR-014 finding text (the 5/5 and 6th/7th
reproduction data, the stateless-rendering-adapter root cause) is
preserved verbatim underneath, relabeled "Historical record," per this
directive's own instruction not to rewrite DIR-012's or DIR-014's own
archived Resolution sections. Neither `experiment/directives/archive/
DIR-012-nested-subagent-terminology-and-audit-requirement.md` nor
`experiment/directives/archive/DIR-014-arm-manda-monitor-in-driving-
session-and-continue-nested-subagent-audit-exploration.md` was edited by
this iteration — both remain accurate, unedited records of what was found
at the time, exactly as this directive's action 3 required.

**(d) Action 4 — applied.** Added a new `§0b. Manda nested-subagent
guidance for development/testing operations` section, scoped explicitly
to development/testing operations (not G3 audit dispatch, which §5 now
permanently excludes this mechanism from). It states the preference for
manda nested-subagent use once §0a's non-blocking precondition is in
place, and carries the three mandatory caveats this directive's action 4
requested verbatim in spirit: reliability must be demonstrated **per
use** (a live-verified success cited each time, not assumed from this
guidance or from a single prior trial), this guidance must **never**
silently become load-bearing for G3 or any other guardrail without its
own separate, explicit directive, and failures must be recorded plainly
rather than silently reverted to a fallback without comment.

**(e) Dispatch-mode observation for this iteration.** This iteration
(70) was itself dispatched as the first live test of action 1/2's
requirement. From inside this executing subagent's own context, there is
genuinely no way to directly observe the `run_in_background` argument
value the orchestrator used to invoke it — no record of the invoking
dispatch call appears anywhere in this session's own transcript or tool
list, exactly as iteration 69 already found when it deferred DIR-015 for
this same reason. This iteration does not guess or assert a value on the
orchestrator's behalf. Per action 2's own text, it is the **orchestrator's**
job — not this subagent's — to confirm and record, in the orchestrator's
own record, that it dispatched this iteration non-blockingly and remained
unblocked afterward. This iteration's own report (`experiment/iterations/
iteration-70.md`) states this limitation plainly rather than fabricating
a self-observation.

**(f) V-factor movement: none claimed.** This is protocol/directive-
application work (four `ITERATION-PROMPTS.md` section edits: two new
sections, one amended section, one new checklist item), not a feature
increment to quay-native, quay-github, or Core. No `V_instance` or
`V_meta` factor is credited — see `experiment/iterations/iteration-70.md`
§7-8 for the full factor-by-factor reasoning, applying the same standard
iterations 8, 18, 29, 65, 67 used for prior process/prompt-maintenance-
only work.

**(g) No self-audit performed by this iteration.** Consistent with the
explicit instruction this iteration was dispatched under (in direct
response to iteration 69's G3 violation), this executing session did
**not** author, commit, or otherwise create any file with "audit" or
"adjudicate" in its name, and does not claim to have performed or
dispatched its own independent out-of-band audit. That is exclusively the
top-level orchestrator's separate job, to be done afterward via a
freshly-dispatched, genuinely independent subagent with no shared context
with this iteration's work.
