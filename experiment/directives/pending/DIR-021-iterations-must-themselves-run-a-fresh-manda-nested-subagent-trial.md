---
status: pending
created_by: human (calvino.huang@gmail.com), asserted directly in this live conversation
created_at: 2026-07-16
title: Iterations must themselves attempt a fresh, live manda nested-subagent trial when a directive calls for verifying that capability — not substitute cross-session reconstruction or "existing evidence already suffices" reasoning for actually running it
---

## Finding

Iteration 78 was tasked (via DIR-019 action 2 + DIR-020 action 3) with
resolving DIR-019's open question about manda nested-subagent reliability
("broker-availability artifact only" vs. "genuine daemon-side SSE bug").
Instead of dispatching and running its own fresh, live 2-level manda
nested-subagent trial, iteration 78:

- Re-read DIR-019's and DIR-020's existing text,
- Recomputed the tally of past successes/failures from that existing
  text (correctly catching that DIR-020 had overcounted "three" clean
  successes when only two are actually documented),
- Concluded, on the strength of that recomputed tally, that DIR-019's
  question was "resolved" and archived it —

— **without itself attempting a new live trial**, reasoning (per its own
§2 checklist note) that "this is directive-application/documentation
work, not a dev/test capability-borrowing trial per §0b, so no fresh
dispatch was attempted."

This was independently re-verified by iteration 78's own G3 audit and
found to be an *honest* recomputation of existing evidence — the audit
confirmed the corrected tally (2 successes, 3 explained failures) is
arithmetically accurate and not fabricated. But accuracy of the
recomputation is a different question from whether re-analyzing
existing, already-recorded evidence is an adequate substitute for
DIR-019's own explicit action 2 request: "**re-run and record at least
one additional live-broker trial**." DIR-020's action 3 language ("DIR-019
may be archived once this directive's action 2 is applied") described
this as sufficient, but that permissive reading should not have been
taken at face value by the very iteration whose job was to critically
apply the directive, not simply defer to it — the same standing
discipline this experiment already applies to every other directive
claim (verify, don't just adopt).

The deeper, generalizable problem: an iteration should never treat
"analyzing what a *different* session did, or re-deriving a tally from
already-existing text" as equivalent to "personally, freshly verifying
the capability in question, right now, in this iteration's own
execution." This is the same class of discipline this experiment already
enforces for σ/V claims (never trust a precedent's conclusion without
reading its full original reasoning) and should apply with at least
equal force to capability-verification claims like manda nested-subagent
reliability.

## Requested action

1. Whenever a current or future directive calls for verifying,
   demonstrating, or concluding something about manda nested-subagent
   reliability (or any other capability this experiment treats as
   open/unproven), the executing iteration must itself attempt a fresh,
   live, end-to-end trial — following the now-codified hard rule in
   `experiment/ITERATION-PROMPTS.md` §0b (depth-1 caller dispatched as a
   separate background subagent, distinct from the session owning the
   target broker's monitor) — and report genuine, verbatim, freshly-
   captured evidence (request IDs, timestamps, actual tool output) from
   *that trial*, not from historical/cross-session reconstruction alone.
2. Re-analysis of existing evidence (recomputing a tally, correcting an
   overcount, re-reading a precedent) remains valuable and should
   continue to happen — but it must be treated as a *supplement* to a
   fresh trial, never a *substitute* for one, when the task at hand is to
   resolve an open reliability question about a capability.
3. Revisit `experiment/directives/archive/DIR-019-...md` and
   `DIR-020-...md`: their conclusions (2 successes, 3 explained failures,
   "broker-availability artifact only") were independently re-verified as
   arithmetically honest by iteration 78's own audit, so this directive
   does **not** ask you to overturn that conclusion — but the *next*
   iteration that touches manda nested-subagent work should still run one
   genuinely fresh trial under the now-codified §0b rule, both to add a
   third real data point and to establish the practice this directive is
   asking for, rather than leaving the record's confidence resting solely
   on a re-tallied historical count.
4. Record, in whichever iteration applies this directive, an honest
   assessment of whether a fresh trial was actually run (with evidence),
   or whether a genuine blocker prevented it (e.g., no live daemon, no
   armed broker reachable from that iteration's own execution context) —
   do not claim a trial happened if it did not.

<!-- ## Resolution: to be filled in by the iteration that applies this directive -->

## Progress note (iteration 79, 2026-07-16)

Iteration 79 applied this directive's action 1 for the first time. It
attempted, and successfully ran, a genuinely fresh, live, end-to-end
manda nested-subagent trial from its own execution context — targeting
`terminal` (a channel bound to a monitor process under a genuinely
distinct, independently-running session, PID 3526382, NOT this
iteration's own orchestrator session 3176586) — before touching or
re-analyzing any existing evidence tally. Verbatim outcome:
`mcp__plugin_manda_manda__Agent(to="terminal", timeout=90)` returned
`{"value":"iteration-79-pong"}`, an exact echo of the requested ping
text, over a ~30-37s round trip, well inside the 90s deadline. Full
detail, including the process-tree disambiguation work needed to confirm
`terminal`'s broker was genuinely distinct (two differently-rooted
"cord"-named monitors exist on this machine, on two different daemons,
which had to be told apart first), is in
`experiment/iterations/iteration-79.md` §5-6.

One honest limitation recorded: no native `Agent`/Task subagent-dispatch
tool was available in iteration 79's own execution context to wrap the
depth-1 call in a background dispatch, as §0b's own recommended (not
hard-rule) practice describes — only manda's own `Agent` proxy was
available, callable only directly from the iteration's own turn. This
did not create a self-deadlock (the chosen target, `terminal`, was not
bound to iteration 79's own session), but it means the "belt-and-
suspenders" background-wrapping practice itself remains untested for lack
of an available native tool to perform it with, in any iteration's
typical execution context, whenever it is not itself a background
subagent with genuine Agent/Task tool access. This is worth a future
directive if it starts to matter (e.g. if a future genuinely
self-deadlocking configuration is the only reachable target and no
background-wrapper tool is available either).

**Status decision**: left `pending` (standing SOP), not archived. Iter-
ation 79's own full reasoning for this choice is in
`experiment/iterations/iteration-79.md` §11 — in short, this directive's
own action 1 text is already a standing, by-name-re-applicable
requirement anchored to the existing §0b hard-rule machinery, not a
one-time task; it should be re-read and re-applied, in full, by any
future iteration whose work touches manda nested-subagent reliability,
rather than archived after a single successful occurrence or promoted
into a new mechanized per-iteration §0 checklist item absent evidence
that its conditional trigger is going dormant (the DIR-017 precedent for
when that promotion is warranted).

## Progress note (iteration 80, 2026-07-16)

Iteration 80 applied this directive's action 1 a second time, and this
time targeted the actual hard/ambiguous case iteration 79 had identified
but declined to test (`cord`, bound to a monitor under the orchestrator's
own process tree) — per the freshly-filed DIR-022 (see that directive's
own file for the full finding and this same progress note's sibling
entry there). Result: **success**. `mcp__plugin_manda_manda__Agent(to=
"cord", timeout=90)`, issued directly from this iteration's own
dispatched-subagent turn (PPID 3176586 — the identical PPID as the `cord`
monitor's own parent process, 214935/214955), returned
`{"value":"iteration-80-cord-pong"}` — an exact echo of the requested
text — over a ~50.7s round trip (`date -u` bracket
2026-07-16T12:11:42.454Z → 2026-07-16T12:12:33.123Z), comfortably inside
the 90s deadline, no timeout.

This is a load-bearing result for this directive's own action 1 language
("following the now-codified hard rule... depth-1 caller dispatched as a
separate background subagent, distinct from the session owning the
target broker's monitor"): OS process-tree ancestry between caller and
broker (same PPID) did **not**, by itself, cause a self-deadlock. This is
consistent with — and now has a first genuine empirical data point
supporting — the refined reading DIR-022's own Finding proposed: the §0b
hard rule's actual mechanism is same-live-conversational-turn identity
between caller and broker, not OS process-tree ancestry. See DIR-022's own
Progress note and the iteration-80 report (`experiment/iterations/
iteration-80.md` §5-6) for full evidence, reasoning, and the
distinction between this result and the one prior confirmed genuine
self-deadlock (DIR-020, iteration 78, where the caller and broker WERE
the identical live top-level turn, not merely process-tree kin).

**Status decision: still left `pending`** (standing SOP), unchanged from
iteration 79's disposition — this directive's own action 1 text remains a
standing, by-name-re-applicable requirement, not a one-time task, and
this iteration's success in applying it to a harder case does not change
that structural assessment. See DIR-022's own Progress note for that
directive's separate disposition (which does report an outcome specific
to the ambiguity DIR-022 itself was filed to resolve).
